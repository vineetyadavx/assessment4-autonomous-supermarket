// Rule-based Store Brain. It sees only the closing state of the day (never the future).
// Rules: low stock, sold out, expiry warning, slow mover, replenishment under a cash limit.

import { dayType } from './model.js';

export const BRAIN_CONFIG = {
  name: 'rule-based-store-brain-v1',
  description:
    'Daily review at close. Demand estimate = traffic-adjusted average of the last 7 days (sales + lost demand). ' +
    'Order-up-to target = estimated next-day demand x cover days + safety stock. Cover: 4 days for normal ' +
    'non-perishables, 3 for fast movers, and shelf life minus 1 day (limited to 1-3 days) for perishables. ' +
    'Stock expiring before it can sell is excluded from sellable stock. Orders are funded in priority order ' +
    '(sold out, then low stock, then routine; highest expected gross profit first) until cash runs out.',
  windowDays: 7,
  dayFactor: { weekday: 1.13, saturday: 0.72, sunday: 0.61 },
  nonPerishableCoverDays: 4,
  fastMoverUnitsPerDay: 20,
  fastMoverCoverDays: 3,
  perishableCoverMin: 1,
  perishableCoverMax: 3,
  safetySd: 0.5,
  minTargetNonPerishable: 3,
  minTargetPerishable: 2,
  lowStockCoverDays: 1.0,
  slowMoverCoverDays: 25,
  slowMoverMinDay: 8,
  slowMoverRepeatDays: 7,
  expiryWarningDays: 2
};

const sum = (a) => a.reduce((x, y) => x + y, 0);
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const money = (n) => `A$${n.toFixed(2)}`;

export function createBrain(overrides = {}) {
  const cfg = { ...BRAIN_CONFIG, ...overrides };
  const lastSlowFlag = new Map();

  function review(view) {
    const { day, cash, canOrder, products } = view;
    const f = (d) => cfg.dayFactor[dayType(d)];

    const windowDays = [];
    for (let d = Math.max(1, day - cfg.windowDays + 1); d <= day; d++) windowDays.push(d);
    const sumFactors = sum(windowDays.map(f));

    // ---- 1. analyse every product ----
    const analysed = products.map((p) => {
      const demand = windowDays.map((d) => p.sold_history[d - 1] + p.lost_history[d - 1]);
      const sold = windowDays.map((d) => p.sold_history[d - 1]);
      const totalDemand = sum(demand);
      const base = totalDemand / sumFactors;
      const norm = windowDays.map((d, i) => demand[i] / f(d));
      const meanNorm = sum(norm) / norm.length;
      const sd = Math.sqrt(sum(norm.map((x) => (x - meanNorm) ** 2)) / norm.length);
      const est = base * f(day + 1);
      const safety = cfg.safetySd * sd * f(day + 1);

      const sellable = p.lots
        .filter((l) => l.expiry_day === null || l.expiry_day > day + 1)
        .reduce((s, l) => s + l.qty, 0);

      let cover;
      if (!p.perishable) {
        cover = est >= cfg.fastMoverUnitsPerDay ? cfg.fastMoverCoverDays : cfg.nonPerishableCoverDays;
      } else {
        cover = clamp(p.shelf_life_days - 1, cfg.perishableCoverMin, cfg.perishableCoverMax);
      }

      let target = est * cover + safety;
      if (totalDemand === 0) target = p.perishable ? 0 : cfg.minTargetNonPerishable;
      else target = Math.max(target, p.perishable ? cfg.minTargetPerishable : cfg.minTargetNonPerishable);

      const qty = Math.max(0, Math.ceil(target - sellable));
      const soldOut = p.stockout_hour !== null;
      const low = !soldOut && sellable < est * cfg.lowStockCoverDays;
      const priority = soldOut ? 1 : low ? 2 : 3;
      const profit = est * (p.unit_price - p.unit_cost);

      return { p, est, safety, sellable, cover, target, qty, soldOut, low, priority, profit, sold, sd };
    });

    // ---- 2. replenishment under the cash limit ----
    let cashCents = Math.round(cash * 100);
    const outcomes = new Map();
    const orders = [];
    if (canOrder) {
      const candidates = analysed
        .filter((a) => a.qty > 0)
        .sort((a, b) => a.priority - b.priority || b.profit - a.profit);
      for (const a of candidates) {
        const unitCents = Math.round(a.p.unit_cost * 100);
        const affordable = Math.floor(cashCents / unitCents);
        const ordered = Math.min(a.qty, affordable);
        cashCents -= ordered * unitCents;
        outcomes.set(a.p.product_id, { requested: a.qty, ordered });
        const tag = a.soldOut ? 'SOLD OUT' : a.low ? 'LOW STOCK' : 'ROUTINE';
        orders.push({
          product_id: a.p.product_id,
          requested_qty: a.qty,
          ordered_qty: ordered,
          reason:
            `${tag}: expected ${a.est.toFixed(1)}/day, cover ${a.cover} day(s), sellable ${a.sellable}, ` +
            `target ${Math.ceil(a.target)}`
        });
      }
    }

    const orderText = (a) => {
      if (!canOrder) return 'No order placed: Day 60 is the last simulated day';
      const o = outcomes.get(a.p.product_id);
      if (!o) return 'No order needed: stock already covers expected demand';
      if (o.ordered === 0) return `Order of ${o.requested} units blocked: no operating cash left`;
      if (o.ordered < o.requested) return `Ordered ${o.ordered} of ${o.requested} units (limited by cash)`;
      return `Ordered ${o.ordered} units, arriving Day ${day + 1}`;
    };

    // ---- 3. alerts ----
    const events = [];
    for (const a of analysed) {
      const p = a.p;

      if (a.soldOut) {
        const when = p.stockout_hour === 6 && p.on_hand === 0 && p.sold_today === 0
          ? 'out of stock all day'
          : `sold out at ${String(p.stockout_hour).padStart(2, '0')}:00`;
        events.push({
          event_type: 'SOLD_OUT', product_id: p.product_id,
          detail: `${p.name} ${when}; ${p.lost_today} units of demand missed today`,
          action_taken: orderText(a)
        });
      } else if (a.low) {
        events.push({
          event_type: 'LOW_STOCK', product_id: p.product_id,
          detail: `${p.name}: ${a.sellable} sellable units vs about ${a.est.toFixed(1)} expected tomorrow`,
          action_taken: orderText(a)
        });
      }

      // expiry warning (lots are already ordered earliest-expiry first)
      let ahead = 0;
      let riskUnits = 0;
      let earliest = null;
      for (const l of p.lots) {
        if (l.expiry_day === null) break;
        const daysLeft = l.expiry_day - (day + 1);
        const canSell = Math.max(0, a.est * daysLeft - ahead);
        const risk = Math.round(Math.max(0, l.qty - canSell));
        ahead += l.qty;
        if (l.expiry_day <= day + cfg.expiryWarningDays && risk >= 1) {
          riskUnits += risk;
          if (earliest === null) earliest = l.expiry_day;
        }
      }
      if (riskUnits > 0) {
        events.push({
          event_type: 'EXPIRY_WARNING', product_id: p.product_id,
          detail:
            `${riskUnits} units of ${p.name} (${money(riskUnits * p.unit_cost)} at cost) are unlikely to sell ` +
            `before expiry (earliest lot expires Day ${earliest})`,
          action_taken: `Excluded from sellable stock; ${orderText(a).toLowerCase()}`
        });
      }

      // slow mover
      const avgSold = sum(a.sold) / windowDays.length;
      const coverDays = p.on_hand / Math.max(avgSold, 0.25);
      const threshold = p.perishable ? p.shelf_life_days : cfg.slowMoverCoverDays;
      const lastFlag = lastSlowFlag.get(p.product_id) ?? -999;
      if (day >= cfg.slowMoverMinDay && p.on_hand >= 8 && coverDays > threshold && lastFlag + cfg.slowMoverRepeatDays <= day) {
        lastSlowFlag.set(p.product_id, day);
        events.push({
          event_type: 'SLOW_MOVER', product_id: p.product_id,
          detail: `${p.name}: ${p.on_hand} units on hand = ${coverDays.toFixed(0)} days of cover at ${avgSold.toFixed(1)} sold/day`,
          action_taken: `Reorder held until cover falls below ${threshold} days; no markdown applied`
        });
      }
    }

    return { events, orders };
  }

  return { CONFIG: { ...cfg }, review };
}