// Report queries. Every figure shown on the website is calculated here from the stored run history.
import db from './db.js';

const r2 = (n) => Math.round(((n ?? 0) + Number.EPSILON) * 100) / 100;
const all = (sql, ...params) => db.prepare(sql).all(...params);
const one = (sql, ...params) => db.prepare(sql).get(...params);
const sumBy = (rows, key) => rows.reduce((s, r) => s + (r[key] ?? 0), 0);

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

function runRow(runId) {
  const run = one('SELECT * FROM runs WHERE run_id = ?', runId);
  if (!run) throw httpError(404, 'Run not found');
  return run;
}

const WEEKDAYS = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const weekdayOf = (day, first) => ((first - 1 + day - 1) % 7) + 1;

const EVENT_TYPES = ['LOW_STOCK', 'SOLD_OUT', 'EXPIRY_WARNING', 'EXPIRY_WRITEOFF', 'SLOW_MOVER', 'REPLENISH', 'CASH_CONSTRAINED'];

// ---------------------------------------------------------------- runs

export function listRuns() {
  return all(`
    SELECT r.run_id, r.label, r.created_at, r.seed, r.opening_cash, r.num_days,
           c.completed_at, c.days_completed,
           CASE WHEN s.run_id IS NULL THEN 0 ELSE 1 END AS submitted,
           (SELECT ROUND(SUM(total), 2) FROM transactions t WHERE t.run_id = r.run_id) AS revenue
    FROM runs r
    LEFT JOIN run_completions c ON c.run_id = r.run_id
    LEFT JOIN submitted_run s ON s.run_id = r.run_id
    ORDER BY r.created_at DESC`);
}

export function getSubmittedRunId() {
  return one('SELECT run_id FROM submitted_run WHERE id = 1')?.run_id ?? null;
}

// ---------------------------------------------------------------- model declaration

export function getModel(runId) {
  const run = runRow(runId);
  const config = JSON.parse(run.config_json);
  const products = all('SELECT * FROM run_products WHERE run_id = ? ORDER BY product_id', runId).map((p) => ({
    ...p,
    perishable: !!p.perishable
  }));
  const byCategory = {};
  for (const p of products) {
    const c = (byCategory[p.category] ||= { category: p.category, products: 0, perishable: 0, opening_units: 0, opening_cost: 0 });
    c.products += 1;
    c.perishable += p.perishable ? 1 : 0;
    c.opening_units += p.initial_qty;
    c.opening_cost = r2(c.opening_cost + p.initial_qty * p.unit_cost);
  }
  return {
    run: {
      run_id: run.run_id, label: run.label, created_at: run.created_at, seed: run.seed,
      opening_cash: run.opening_cash, inventory_budget: run.inventory_budget, num_days: run.num_days
    },
    completed: one('SELECT * FROM run_completions WHERE run_id = ?', runId) ?? null,
    config,
    products,
    openingInventoryCost: r2(products.reduce((s, p) => s + p.initial_qty * p.unit_cost, 0)),
    categories: Object.values(byCategory)
  };
}

// ---------------------------------------------------------------- per-product table

function productTable(runId, run) {
  const prods = all(
    'SELECT product_id, name, category, unit_cost, unit_price, initial_qty, perishable, shelf_life_days FROM run_products WHERE run_id = ? ORDER BY product_id',
    runId
  );
  const toMap = (rows) => new Map(rows.map((r) => [r.product_id, r]));
  const sales = toMap(all(`SELECT product_id, SUM(qty) AS units, SUM(line_total) AS revenue, SUM(qty * unit_cost) AS cogs FROM transaction_items WHERE run_id = ? GROUP BY product_id`, runId));
  const expired = toMap(all(`SELECT product_id, -SUM(qty) AS units FROM inventory_movements WHERE run_id = ? AND movement_type = 'EXPIRY' GROUP BY product_id`, runId));
  const received = toMap(all(`SELECT product_id, SUM(qty) AS units FROM inventory_movements WHERE run_id = ? AND movement_type = 'RECEIPT' GROUP BY product_id`, runId));
  const lost = toMap(all(`SELECT product_id, SUM(qty) AS units FROM lost_sales WHERE run_id = ? AND reason != 'SUBSTITUTED' GROUP BY product_id`, runId));
  const closing = toMap(all(`SELECT product_id, SUM(qty) AS units FROM inventory_movements WHERE run_id = ? GROUP BY product_id`, runId));
  const evMap = new Map();
  for (const e of all(`SELECT product_id, event_type, COUNT(*) AS n FROM brain_events WHERE run_id = ? AND product_id IS NOT NULL GROUP BY product_id, event_type`, runId)) {
    if (!evMap.has(e.product_id)) evMap.set(e.product_id, {});
    evMap.get(e.product_id)[e.event_type] = e.n;
  }
  return prods.map((p) => {
    const s = sales.get(p.product_id) || {};
    const units = s.units || 0;
    const exp = expired.get(p.product_id)?.units || 0;
    const cl = closing.get(p.product_id)?.units || 0;
    return {
      ...p,
      perishable: !!p.perishable,
      units_sold: units,
      revenue: r2(s.revenue),
      gross_profit: r2((s.revenue || 0) - (s.cogs || 0)),
      avg_units_per_day: r2(units / run.num_days),
      received_units: received.get(p.product_id)?.units || 0,
      expired_units: exp,
      expired_value: r2(exp * p.unit_cost),
      lost_units: lost.get(p.product_id)?.units || 0,
      closing_units: cl,
      closing_value: r2(cl * p.unit_cost),
      events: evMap.get(p.product_id) || {}
    };
  });
}

// ---------------------------------------------------------------- 60-day report (Parts 1 and 2)

export function getSummary(runId) {
  const run = runRow(runId);
  const config = JSON.parse(run.config_json);
  const first = config.model.firstDayWeekday;
  const N = run.num_days;

  const visits = one(`SELECT COUNT(*) AS customers, COALESCE(SUM(outcome = 'PURCHASED'), 0) AS purchasers FROM customer_visits WHERE run_id = ?`, runId);
  const tx = one(`SELECT COUNT(*) AS n, COALESCE(SUM(units), 0) AS units, COALESCE(SUM(total), 0) AS revenue, COALESCE(SUM(cogs), 0) AS cogs FROM transactions WHERE run_id = ?`, runId);
  const lines = one('SELECT COUNT(*) AS n FROM transaction_items WHERE run_id = ?', runId);
  const lastCash = one('SELECT balance_after FROM cash_ledger WHERE run_id = ? ORDER BY entry_id DESC LIMIT 1', runId);
  const products = productTable(runId, run);

  const revenue = r2(tx.revenue);
  const cogs = r2(tx.cogs);
  const store = {
    customers: visits.customers,
    purchasing_customers: visits.purchasers,
    transactions: tx.n,
    units_sold: tx.units,
    revenue,
    cogs,
    gross_profit: r2(revenue - cogs),
    gross_margin_pct: revenue ? r2(((revenue - cogs) / revenue) * 100) : 0,
    writeoff_units: sumBy(products, 'expired_units'),
    writeoff_value: r2(sumBy(products, 'expired_value')),
    opening_cash: run.opening_cash,
    closing_cash: lastCash?.balance_after ?? run.opening_cash,
    closing_inventory_units: sumBy(products, 'closing_units'),
    closing_inventory_value: r2(sumBy(products, 'closing_value'))
  };

  // daily series
  const vByDay = new Map(all(`SELECT day, COUNT(*) AS customers, COALESCE(SUM(outcome = 'PURCHASED'), 0) AS purchasers FROM customer_visits WHERE run_id = ? GROUP BY day`, runId).map((r) => [r.day, r]));
  const tByDay = new Map(all(`SELECT day, COUNT(*) AS transactions, SUM(units) AS units, SUM(total) AS revenue, SUM(cogs) AS cogs FROM transactions WHERE run_id = ? GROUP BY day`, runId).map((r) => [r.day, r]));
  const daily = [];
  for (let d = 1; d <= N; d++) {
    const v = vByDay.get(d) || { customers: 0, purchasers: 0 };
    const t = tByDay.get(d) || { transactions: 0, units: 0, revenue: 0, cogs: 0 };
    const wd = weekdayOf(d, first);
    daily.push({
      day: d, weekday: WEEKDAYS[wd], weekend: wd >= 6,
      customers: v.customers, purchasers: v.purchasers, transactions: t.transactions, units: t.units,
      revenue: r2(t.revenue), gross_profit: r2(t.revenue - t.cogs)
    });
  }
  const group = (rows) => {
    const n = rows.length || 1;
    const avg = (k) => r2(sumBy(rows, k) / n);
    return { days: rows.length, avg_customers: avg('customers'), avg_transactions: avg('transactions'), avg_units: avg('units'), avg_revenue: avg('revenue') };
  };
  const weekdayVsWeekend = { weekday: group(daily.filter((d) => !d.weekend)), weekend: group(daily.filter((d) => d.weekend)) };
  const bestDay = [...daily].sort((a, b) => b.revenue - a.revenue)[0];
  const worstDay = [...daily].sort((a, b) => a.revenue - b.revenue)[0];

  const shopper = {
    avg_customers_per_day: r2(visits.customers / N),
    conversion_pct: visits.customers ? r2((visits.purchasers / visits.customers) * 100) : 0,
    avg_basket_units: tx.n ? r2(tx.units / tx.n) : 0,
    avg_basket_lines: tx.n ? r2(lines.n / tx.n) : 0,
    avg_transaction_value: tx.n ? r2(revenue / tx.n) : 0,
    weekday_vs_weekend: weekdayVsWeekend,
    best_day: bestDay, worst_day: worstDay,
    event_days: (config.model.events || []).map((e) => ({ name: e.name, days: e.days }))
  };

  const segment = (col) =>
    all(`
      SELECT v.${col} AS name, COUNT(*) AS customers, COALESCE(SUM(v.outcome = 'PURCHASED'), 0) AS purchasers,
             COALESCE(SUM(t.total), 0) AS revenue, COALESCE(SUM(t.units), 0) AS units
      FROM customer_visits v LEFT JOIN transactions t ON t.visit_id = v.visit_id
      WHERE v.run_id = ? GROUP BY v.${col} ORDER BY revenue DESC`, runId
    ).map((r) => ({ ...r, revenue: r2(r.revenue) }));

  const hourlyV = new Map(all('SELECT hour, COUNT(*) AS customers FROM customer_visits WHERE run_id = ? GROUP BY hour', runId).map((r) => [r.hour, r.customers]));
  const hourlyT = new Map(all('SELECT hour, SUM(total) AS revenue FROM transactions WHERE run_id = ? GROUP BY hour', runId).map((r) => [r.hour, r.revenue]));
  const hourly = config.model.tradingHours.map((h) => ({
    hour: h, customers: hourlyV.get(h) || 0, avg_customers_per_day: r2((hourlyV.get(h) || 0) / N), revenue: r2(hourlyT.get(h))
  }));

  // categories
  const categories = {};
  for (const p of products) {
    const c = (categories[p.category] ||= { category: p.category, products: 0, units_sold: 0, revenue: 0, gross_profit: 0, expired_units: 0, expired_value: 0, received_units: 0, closing_units: 0, closing_value: 0 });
    c.products += 1;
    c.units_sold += p.units_sold;
    c.revenue = r2(c.revenue + p.revenue);
    c.gross_profit = r2(c.gross_profit + p.gross_profit);
    c.expired_units += p.expired_units;
    c.expired_value = r2(c.expired_value + p.expired_value);
    c.received_units += p.received_units;
    c.closing_units += p.closing_units;
    c.closing_value = r2(c.closing_value + p.closing_value);
  }
  const categoryList = Object.values(categories).map((c) => ({
    ...c, margin_pct: c.revenue ? r2((c.gross_profit / c.revenue) * 100) : 0, share_of_revenue_pct: revenue ? r2((c.revenue / revenue) * 100) : 0
  })).sort((a, b) => b.revenue - a.revenue);

  const byRevenue = [...products].sort((a, b) => b.revenue - a.revenue);
  const topProducts = byRevenue.slice(0, 10);
  const weakProducts = [...products].sort((a, b) => a.units_sold - b.units_sold).slice(0, 10);

  // ---- Part 2: inventory and autonomous operations
  const evRows = all('SELECT event_type, COUNT(*) AS n, COUNT(DISTINCT product_id) AS products FROM brain_events WHERE run_id = ? GROUP BY event_type', runId);
  const brainCounts = EVENT_TYPES.map((t) => {
    const r = evRows.find((x) => x.event_type === t);
    return { event_type: t, events: r?.n ?? 0, products: r?.products ?? 0 };
  });
  const evCount = (t) => brainCounts.find((b) => b.event_type === t).events;

  const lostRows = all(`SELECT reason, SUM(qty) AS units, COUNT(*) AS lines FROM lost_sales WHERE run_id = ? GROUP BY reason`, runId);
  const lostRevenue = one(`SELECT COALESCE(SUM(l.qty * p.unit_price), 0) AS v FROM lost_sales l JOIN run_products p ON p.run_id = l.run_id AND p.product_id = l.product_id WHERE l.run_id = ? AND l.reason != 'SUBSTITUTED'`, runId).v;
  const lostUnits = lostRows.filter((r) => r.reason !== 'SUBSTITUTED').reduce((s, r) => s + r.units, 0);

  const soldOutTop = all(`
    SELECT e.product_id, p.name, p.category, COUNT(*) AS sold_out_days, MIN(e.day) AS first_day,
           (SELECT COALESCE(SUM(l.qty), 0) FROM lost_sales l WHERE l.run_id = e.run_id AND l.product_id = e.product_id AND l.reason != 'SUBSTITUTED') AS lost_units
    FROM brain_events e JOIN run_products p ON p.run_id = e.run_id AND p.product_id = e.product_id
    WHERE e.run_id = ? AND e.event_type = 'SOLD_OUT'
    GROUP BY e.product_id ORDER BY lost_units DESC, sold_out_days DESC LIMIT 10`, runId);
  const nextDaySoldOut = db.prepare(`SELECT COUNT(*) AS n FROM brain_events WHERE run_id = ? AND event_type = 'SOLD_OUT' AND product_id = ? AND day = ?`);
  const soldOutEvents = db.prepare(`SELECT day, detail, action_taken FROM brain_events WHERE run_id = ? AND event_type = 'SOLD_OUT' AND product_id = ? ORDER BY day LIMIT 6`);
  const soldOutCases = soldOutTop.slice(0, 5).map((s) => ({
    ...s,
    events: soldOutEvents.all(runId, s.product_id).map((e) => ({
      ...e, recovered_next_day: nextDaySoldOut.get(runId, s.product_id, e.day + 1).n === 0 && e.day < N
    }))
  }));

  const expiryByCategory = all(`
    SELECT p.category, -SUM(m.qty) AS units, -SUM(m.qty * l.unit_cost) AS value
    FROM inventory_movements m JOIN inventory_lots l ON l.lot_id = m.lot_id
    JOIN run_products p ON p.run_id = m.run_id AND p.product_id = m.product_id
    WHERE m.run_id = ? AND m.movement_type = 'EXPIRY' GROUP BY p.category ORDER BY value DESC`, runId
  ).map((r) => ({ ...r, value: r2(r.value) }));
  const expiryByProduct = products.filter((p) => p.expired_units > 0).sort((a, b) => b.expired_value - a.expired_value).slice(0, 10)
    .map((p) => ({ product_id: p.product_id, name: p.name, category: p.category, units: p.expired_units, value: p.expired_value, shelf_life_days: p.shelf_life_days }));

  const slowMovers = all(`
    SELECT e.day, e.product_id, p.name, e.detail, e.action_taken
    FROM brain_events e JOIN run_products p ON p.run_id = e.run_id AND p.product_id = e.product_id
    WHERE e.run_id = ? AND e.event_type = 'SLOW_MOVER' ORDER BY e.day, e.product_id`, runId);

  const replenByCategory = all(`
    SELECT p.category, COUNT(*) AS orders, SUM(o.ordered_qty) AS units, SUM(o.line_cost) AS spend
    FROM replenishment_orders o JOIN run_products p ON p.run_id = o.run_id AND p.product_id = o.product_id
    WHERE o.run_id = ? GROUP BY p.category ORDER BY spend DESC`, runId
  ).map((r) => ({ ...r, spend: r2(r.spend) }));
  const replenTotals = one('SELECT COUNT(*) AS orders, COALESCE(SUM(ordered_qty), 0) AS units, COALESCE(SUM(line_cost), 0) AS spend FROM replenishment_orders WHERE run_id = ?', runId);
  const lowCash = one('SELECT day, balance_after FROM cash_ledger WHERE run_id = ? ORDER BY balance_after ASC, entry_id ASC LIMIT 1', runId);
  const peakSpend = one(`SELECT day, -SUM(amount) AS spend FROM cash_ledger WHERE run_id = ? AND entry_type = 'REPLENISHMENT' GROUP BY day ORDER BY spend DESC LIMIT 1`, runId);

  const closingAlerts = all(`
    SELECT e.event_type, e.product_id, p.name, e.detail, e.action_taken
    FROM brain_events e JOIN run_products p ON p.run_id = e.run_id AND p.product_id = e.product_id
    WHERE e.run_id = ? AND e.day = ? AND e.event_type IN ('SOLD_OUT', 'LOW_STOCK') ORDER BY e.event_type, e.product_id`, runId, N);

  return {
    run: { run_id: run.run_id, label: run.label, num_days: N, completed: !!one('SELECT 1 AS x FROM run_completions WHERE run_id = ?', runId) },
    part1: { store, shopper, daily, byCustomerType: segment('customer_type'), byMission: segment('mission'), hourly, categories: categoryList, topProducts, weakProducts },
    part2: {
      inventory: {
        stockout_events: evCount('SOLD_OUT'),
        low_stock_events: evCount('LOW_STOCK'),
        lost_units: lostUnits,
        lost_revenue: r2(lostRevenue),
        lost_by_reason: lostRows,
        soldOutTop, expiryByCategory, expiryByProduct,
        writeoff_units: store.writeoff_units, writeoff_value: store.writeoff_value,
        replenishment: { ...replenTotals, spend: r2(replenTotals.spend), by_category: replenByCategory },
        closing_units: store.closing_inventory_units, closing_value: store.closing_inventory_value
      },
      brain: {
        counts: brainCounts,
        cash_constrained_events: evCount('CASH_CONSTRAINED'),
        lowest_cash: lowCash ? { day: lowCash.day, balance: lowCash.balance_after } : null,
        peak_daily_spend: peakSpend ? { day: peakSpend.day, spend: r2(peakSpend.spend) } : null,
        soldOutCases, slowMovers, closingAlerts
      }
    },
    products
  };
}

// ---------------------------------------------------------------- daily report

export function getDaily(runId, dayIn) {
  const run = runRow(runId);
  const day = Number(dayIn);
  if (!Number.isInteger(day) || day < 1 || day > run.num_days) throw httpError(400, 'Day out of range');
  const config = JSON.parse(run.config_json);
  const wd = weekdayOf(day, config.model.firstDayWeekday);

  const v = one(`SELECT COUNT(*) AS customers, COALESCE(SUM(outcome = 'PURCHASED'), 0) AS purchasers FROM customer_visits WHERE run_id = ? AND day = ?`, runId, day);
  const t = one(`SELECT COUNT(*) AS transactions, COALESCE(SUM(units), 0) AS units, COALESCE(SUM(total), 0) AS revenue, COALESCE(SUM(cogs), 0) AS cogs FROM transactions WHERE run_id = ? AND day = ?`, runId, day);

  const hv = new Map(all(`SELECT hour, COUNT(*) AS customers, COALESCE(SUM(outcome = 'PURCHASED'), 0) AS purchasers FROM customer_visits WHERE run_id = ? AND day = ? GROUP BY hour`, runId, day).map((r) => [r.hour, r]));
  const ht = new Map(all('SELECT hour, COUNT(*) AS transactions, SUM(total) AS revenue FROM transactions WHERE run_id = ? AND day = ? GROUP BY hour', runId, day).map((r) => [r.hour, r]));
  const hourly = config.model.tradingHours.map((h) => ({
    hour: h, customers: hv.get(h)?.customers || 0, purchasers: hv.get(h)?.purchasers || 0,
    transactions: ht.get(h)?.transactions || 0, revenue: r2(ht.get(h)?.revenue)
  }));

  const byType = all(`
    SELECT v.customer_type AS name, COUNT(*) AS customers, COALESCE(SUM(v.outcome = 'PURCHASED'), 0) AS purchasers, COALESCE(SUM(t.total), 0) AS revenue
    FROM customer_visits v LEFT JOIN transactions t ON t.visit_id = v.visit_id
    WHERE v.run_id = ? AND v.day = ? GROUP BY v.customer_type ORDER BY revenue DESC`, runId, day
  ).map((r) => ({ ...r, revenue: r2(r.revenue) }));

  // cash
  const entries = all('SELECT entry_id, entry_type, amount, balance_after, ref_id FROM cash_ledger WHERE run_id = ? AND day = ? ORDER BY entry_id', runId, day);
  const prev = day === 1 ? null : one('SELECT balance_after FROM cash_ledger WHERE run_id = ? AND day < ? ORDER BY entry_id DESC LIMIT 1', runId, day);
  const cashOpen = day === 1 ? run.opening_cash : prev?.balance_after ?? 0;
  const cashSales = r2(entries.filter((e) => e.entry_type === 'SALES').reduce((s, e) => s + e.amount, 0));
  const cashSpend = r2(-entries.filter((e) => e.entry_type === 'REPLENISHMENT').reduce((s, e) => s + e.amount, 0));
  const cashClose = entries.length ? entries[entries.length - 1].balance_after : cashOpen;

  // inventory
  const mv = Object.fromEntries(all('SELECT movement_type AS t, SUM(qty) AS q FROM inventory_movements WHERE run_id = ? AND day = ? GROUP BY movement_type', runId, day).map((r) => [r.t, r.q]));
  const startUnits = one('SELECT COALESCE(SUM(qty), 0) AS u FROM inventory_movements WHERE run_id = ? AND day < ?', runId, day).u;
  const openingStock = mv.OPENING || 0;
  const receipts = mv.RECEIPT || 0;
  const sold = -(mv.SALE || 0);
  const expired = -(mv.EXPIRY || 0);
  const closingUnits = startUnits + openingStock + receipts - sold - expired;
  const closingValue = one(`
    SELECT COALESCE(SUM(rem * unit_cost), 0) AS v FROM (
      SELECT l.unit_cost, SUM(m.qty) AS rem FROM inventory_lots l JOIN inventory_movements m ON m.lot_id = l.lot_id
      WHERE l.run_id = ? AND m.day <= ? GROUP BY l.lot_id)`, runId, day).v;

  const events = all(`
    SELECT e.event_id, e.event_type, e.product_id, p.name AS product_name, e.detail, e.action_taken, e.ref_order_id
    FROM brain_events e LEFT JOIN run_products p ON p.run_id = e.run_id AND p.product_id = e.product_id
    WHERE e.run_id = ? AND e.day = ? ORDER BY e.event_id`, runId, day);
  const orderCols = `o.order_id, o.product_id, p.name, o.requested_qty, o.ordered_qty, o.unit_cost, o.line_cost, o.reason, o.day_placed, o.day_due`;
  const placed = all(`SELECT ${orderCols} FROM replenishment_orders o JOIN run_products p ON p.run_id = o.run_id AND p.product_id = o.product_id WHERE o.run_id = ? AND o.day_placed = ? ORDER BY o.order_id`, runId, day);
  const arrived = all(`SELECT ${orderCols} FROM replenishment_orders o JOIN run_products p ON p.run_id = o.run_id AND p.product_id = o.product_id WHERE o.run_id = ? AND o.day_due = ? ORDER BY o.order_id`, runId, day);
  const expiredProducts = all(`
    SELECT m.product_id, p.name, -SUM(m.qty) AS units, -SUM(m.qty * l.unit_cost) AS value
    FROM inventory_movements m JOIN inventory_lots l ON l.lot_id = m.lot_id
    JOIN run_products p ON p.run_id = m.run_id AND p.product_id = m.product_id
    WHERE m.run_id = ? AND m.day = ? AND m.movement_type = 'EXPIRY' GROUP BY m.product_id ORDER BY value DESC`, runId, day
  ).map((r) => ({ ...r, value: r2(r.value) }));
  const productsSold = all(`
    SELECT i.product_id, p.name, p.category, SUM(i.qty) AS units, SUM(i.line_total) AS revenue
    FROM transaction_items i JOIN run_products p ON p.run_id = i.run_id AND p.product_id = i.product_id
    WHERE i.run_id = ? AND i.day = ? GROUP BY i.product_id ORDER BY units DESC`, runId, day
  ).map((r) => ({ ...r, revenue: r2(r.revenue) }));
  const lost = all(`
    SELECT l.product_id, p.name, l.reason, SUM(l.qty) AS units
    FROM lost_sales l JOIN run_products p ON p.run_id = l.run_id AND p.product_id = l.product_id
    WHERE l.run_id = ? AND l.day = ? GROUP BY l.product_id, l.reason ORDER BY units DESC`, runId, day);

  return {
    day, weekday: WEEKDAYS[wd], is_weekend: wd >= 6, num_days: run.num_days,
    special_events: (config.model.events || []).filter((e) => e.days.includes(day)).map((e) => e.name),
    trading: {
      customers: v.customers, purchasers: v.purchasers, walked_out: v.customers - v.purchasers,
      transactions: t.transactions, units: t.units, revenue: r2(t.revenue), cogs: r2(t.cogs), gross_profit: r2(t.revenue - t.cogs),
      avg_basket_units: t.transactions ? r2(t.units / t.transactions) : 0,
      avg_transaction_value: t.transactions ? r2(t.revenue / t.transactions) : 0
    },
    hourly, byCustomerType: byType,
    cash: { opening: cashOpen, sales: cashSales, replenishment_spend: cashSpend, closing: cashClose, entries },
    inventory: {
      start_units: startUnits, opening_stock: openingStock, received_units: receipts, sold_units: sold, expired_units: expired,
      closing_units: closingUnits, closing_value: r2(closingValue)
    },
    events, ordersPlaced: placed, ordersArrived: arrived, expiredProducts, productsSold, lostSales: lost
  };
}

export function getDayTransactions(runId, dayIn, offsetIn = 0, limitIn = 50) {
  runRow(runId);
  const day = Number(dayIn);
  const offset = Math.max(0, Number(offsetIn) || 0);
  const limit = Math.min(200, Math.max(1, Number(limitIn) || 50));
  const total = one('SELECT COUNT(*) AS n FROM transactions WHERE run_id = ? AND day = ?', runId, day).n;
  const rows = all(`
    SELECT t.txn_id, t.hour, t.units, t.total, v.customer_type, v.mission
    FROM transactions t LEFT JOIN customer_visits v ON v.visit_id = t.visit_id
    WHERE t.run_id = ? AND t.day = ? ORDER BY t.txn_id LIMIT ? OFFSET ?`, runId, day, limit, offset);
  return { total, offset, limit, rows };
}

export function getTransaction(runId, txnIdIn) {
  runRow(runId);
  const txn = one(`
    SELECT t.txn_id, t.day, t.hour, t.units, t.total, t.cogs, v.customer_type, v.mission
    FROM transactions t LEFT JOIN customer_visits v ON v.visit_id = t.visit_id
    WHERE t.run_id = ? AND t.txn_id = ?`, runId, Number(txnIdIn));
  if (!txn) throw httpError(404, 'Transaction not found');
  const items = all(`
    SELECT i.product_id, p.name, i.qty, i.unit_price, i.unit_cost, i.line_total
    FROM transaction_items i JOIN run_products p ON p.run_id = i.run_id AND p.product_id = i.product_id
    WHERE i.run_id = ? AND i.txn_id = ? ORDER BY i.item_id`, runId, txn.txn_id);
  return { ...txn, items };
}

// ---------------------------------------------------------------- product trace

export function getProductTrace(runId, productId) {
  const run = runRow(runId);
  const product = one('SELECT * FROM run_products WHERE run_id = ? AND product_id = ?', runId, productId);
  if (!product) throw httpError(404, 'Product not found');
  const mv = all('SELECT day, movement_type AS t, SUM(qty) AS q FROM inventory_movements WHERE run_id = ? AND product_id = ? GROUP BY day, movement_type', runId, productId);
  const lostByDay = new Map(all(`SELECT day, SUM(qty) AS q FROM lost_sales WHERE run_id = ? AND product_id = ? AND reason != 'SUBSTITUTED' GROUP BY day`, runId, productId).map((r) => [r.day, r.q]));
  const revByDay = new Map(all('SELECT day, SUM(line_total) AS r FROM transaction_items WHERE run_id = ? AND product_id = ? GROUP BY day', runId, productId).map((r) => [r.day, r.r]));
  let stock = 0;
  const series = [];
  for (let d = 1; d <= run.num_days; d++) {
    const get = (t) => mv.find((m) => m.day === d && m.t === t)?.q || 0;
    const opening = get('OPENING');
    const received = get('RECEIPT');
    const sold = -get('SALE');
    const expired = -get('EXPIRY');
    stock += opening + received - sold - expired;
    series.push({ day: d, opening, received, sold, expired, lost: lostByDay.get(d) || 0, revenue: r2(revByDay.get(d)), closing: stock });
  }
  const events = all('SELECT day, event_type, detail, action_taken FROM brain_events WHERE run_id = ? AND product_id = ? ORDER BY event_id', runId, productId);
  const orders = all('SELECT order_id, day_placed, day_due, requested_qty, ordered_qty, line_cost, reason FROM replenishment_orders WHERE run_id = ? AND product_id = ? ORDER BY order_id', runId, productId);
  return { product: { ...product, perishable: !!product.perishable }, series, events, orders };
}

// ---------------------------------------------------------------- commercial assurance

export function getAssurance(runId) {
  const run = runRow(runId);
  const N = run.num_days;
  const comp = one('SELECT * FROM run_completions WHERE run_id = ?', runId);
  const TOL = 0.005;
  const checks = [];
  const add = (area, name, expected, actual, ok, note = '') => checks.push({ area, name, expected, actual, status: ok ? 'PASS' : 'FAIL', note });

  // ---- history completeness
  const tables = ['customer_visits', 'transactions', 'transaction_items', 'inventory_lots', 'inventory_movements', 'replenishment_orders', 'cash_ledger', 'brain_events', 'lost_sales', 'run_products'];
  const counts = {};
  for (const t of tables) counts[t] = one(`SELECT COUNT(*) AS n FROM ${t} WHERE run_id = ?`, runId).n;
  const daysRetained = one(`SELECT COUNT(DISTINCT day) AS n FROM cash_ledger WHERE run_id = ? AND entry_type = 'SALES'`, runId).n;
  const triggers = one(`SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'trigger' AND name LIKE '%_no_update'`).n
    + one(`SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'trigger' AND name LIKE '%_no_delete'`).n;
  const history = {
    run_id: runId, label: run.label, created_at: run.created_at, completed_at: comp?.completed_at ?? null,
    days_retained: daysRetained, days_expected: N, counts, append_only_triggers: triggers,
    config_frozen: true, submitted: getSubmittedRunId() === runId
  };
  add('History', 'Run has a completion record', 'yes', comp ? 'yes' : 'no', !!comp);
  add('History', 'Days retained', `${N}/${N}`, `${daysRetained}/${N}`, daysRetained === N && comp?.days_completed === N);
  add('History', 'Audit records retained (transactions, inventory, replenishment, Store Brain)', '> 0 each',
    `${counts.transactions} / ${counts.inventory_movements} / ${counts.replenishment_orders} / ${counts.brain_events}`,
    counts.transactions > 0 && counts.inventory_movements > 0 && counts.replenishment_orders > 0 && counts.brain_events > 0);
  add('History', 'Append-only protection (update and delete blocked by database triggers)', '24 triggers', `${triggers} triggers`, triggers >= 24, 'Applies to configuration and every history table');

  // ---- inventory reconciliation (independent sources: catalogue, orders, transactions, movement ledger)
  const prod = all(`
    SELECT p.product_id, p.name, p.category, p.initial_qty AS opening,
      COALESCE((SELECT SUM(o.ordered_qty) FROM replenishment_orders o WHERE o.run_id = p.run_id AND o.product_id = p.product_id AND o.day_due <= ?), 0) AS received,
      COALESCE((SELECT SUM(i.qty) FROM transaction_items i WHERE i.run_id = p.run_id AND i.product_id = p.product_id), 0) AS sold,
      COALESCE((SELECT -SUM(m.qty) FROM inventory_movements m WHERE m.run_id = p.run_id AND m.product_id = p.product_id AND m.movement_type = 'EXPIRY'), 0) AS expired,
      COALESCE((SELECT SUM(m.qty) FROM inventory_movements m WHERE m.run_id = p.run_id AND m.product_id = p.product_id), 0) AS closing
    FROM run_products p WHERE p.run_id = ? ORDER BY p.product_id`, N, runId
  ).map((p) => {
    const expectedClosing = p.opening + p.received - p.sold - p.expired;
    return { ...p, expected_closing: expectedClosing, difference: expectedClosing - p.closing, status: expectedClosing === p.closing ? 'PASS' : 'FAIL' };
  });
  const invTotals = {
    opening: sumBy(prod, 'opening'), received: sumBy(prod, 'received'), sold: sumBy(prod, 'sold'),
    expired: sumBy(prod, 'expired'), closing: sumBy(prod, 'closing')
  };
  invTotals.expected_closing = invTotals.opening + invTotals.received - invTotals.sold - invTotals.expired;
  const invFails = prod.filter((p) => p.status === 'FAIL').length;
  add('Inventory', 'Opening + received - sold - expired = closing (all units)', invTotals.expected_closing, invTotals.closing, invTotals.expected_closing === invTotals.closing,
    `${invTotals.opening} + ${invTotals.received} - ${invTotals.sold} - ${invTotals.expired}`);
  add('Inventory', 'Same equation holds for every product', `0 of ${prod.length} products fail`, `${invFails} of ${prod.length} fail`, invFails === 0);

  const negLots = one(`SELECT COUNT(*) AS n FROM (SELECT lot_id FROM inventory_movements WHERE run_id = ? GROUP BY lot_id HAVING SUM(qty) < 0)`, runId).n;
  let negProductDays = 0;
  let cur = null;
  let bal = 0;
  for (const r of all('SELECT product_id, day, SUM(qty) AS q FROM inventory_movements WHERE run_id = ? GROUP BY product_id, day ORDER BY product_id, day', runId)) {
    if (r.product_id !== cur) { cur = r.product_id; bal = 0; }
    bal += r.q;
    if (bal < 0) negProductDays += 1;
  }
  const expiredSales = one(`
    SELECT COUNT(*) AS n FROM inventory_movements m JOIN inventory_lots l ON l.lot_id = m.lot_id
    WHERE m.run_id = ? AND m.movement_type = 'SALE' AND l.expiry_day IS NOT NULL AND m.day >= l.expiry_day`, runId).n;
  const orphan = one(`SELECT COUNT(*) AS n FROM transaction_items i LEFT JOIN run_products p ON p.run_id = i.run_id AND p.product_id = i.product_id WHERE i.run_id = ? AND p.product_id IS NULL`, runId).n;
  add('Inventory', 'Negative stock (product-days)', 0, negProductDays, negProductDays === 0);
  add('Inventory', 'Overselling (lots driven below zero)', 0, negLots, negLots === 0);
  add('Inventory', 'Sales of expired stock', 0, expiredSales, expiredSales === 0);
  add('Inventory', 'Transactions containing products not in the catalogue', 0, orphan, orphan === 0);

  // ---- revenue reconciliation
  const rev = all(`
    SELECT d.day,
      COALESCE((SELECT SUM(t.total) FROM transactions t WHERE t.run_id = ? AND t.day = d.day), 0) AS transaction_total,
      COALESCE((SELECT SUM(i.line_total) FROM transaction_items i WHERE i.run_id = ? AND i.day = d.day), 0) AS item_total,
      COALESCE((SELECT SUM(c.amount) FROM cash_ledger c WHERE c.run_id = ? AND c.day = d.day AND c.entry_type = 'SALES'), 0) AS daily_revenue
    FROM (SELECT DISTINCT day FROM cash_ledger WHERE run_id = ?) d ORDER BY d.day`, runId, runId, runId, runId
  ).map((r) => ({
    ...r, transaction_total: r2(r.transaction_total), item_total: r2(r.item_total), daily_revenue: r2(r.daily_revenue),
    difference: r2(r.daily_revenue - r.transaction_total),
    status: Math.abs(r.daily_revenue - r.transaction_total) < TOL && Math.abs(r.item_total - r.transaction_total) < TOL ? 'PASS' : 'FAIL'
  }));
  const revFails = rev.filter((r) => r.status === 'FAIL').length;
  const sumDaily = r2(sumBy(rev, 'daily_revenue'));
  const sumTxn = r2(one('SELECT COALESCE(SUM(total), 0) AS v FROM transactions WHERE run_id = ?', runId).v);
  const txnMismatch = one(`
    SELECT COUNT(*) AS n FROM transactions t
    WHERE t.run_id = ? AND ABS(t.total - COALESCE((SELECT SUM(i.line_total) FROM transaction_items i WHERE i.txn_id = t.txn_id), 0)) > ?`, runId, TOL).n;
  add('Revenue', 'Daily revenue = sum of recorded transaction totals (every day)', `0 of ${rev.length} days differ`, `${revFails} of ${rev.length} differ`, revFails === 0);
  add('Revenue', '60-day revenue = sum of daily revenue figures', sumTxn, sumDaily, Math.abs(sumTxn - sumDaily) < TOL);
  add('Revenue', 'Every transaction total = sum of its line items', 0, txnMismatch, txnMismatch === 0, 'Count of transactions that differ');

  // ---- operating cash reconciliation
  const ledger = all('SELECT entry_id, day, entry_type, amount, balance_after FROM cash_ledger WHERE run_id = ? ORDER BY entry_id', runId);
  let prevBal = 0;
  let breaks = 0;
  let overspend = 0;
  let negative = 0;
  for (const e of ledger) {
    if (Math.abs(prevBal + e.amount - e.balance_after) > TOL) breaks += 1;
    if (e.entry_type === 'REPLENISHMENT' && prevBal + 1e-9 < -e.amount) overspend += 1;
    if (e.balance_after < -TOL) negative += 1;
    prevBal = e.balance_after;
  }
  const openingCash = one(`SELECT amount FROM cash_ledger WHERE run_id = ? AND entry_type = 'OPENING'`, runId)?.amount ?? 0;
  const spendOrders = r2(one('SELECT COALESCE(SUM(line_cost), 0) AS v FROM replenishment_orders WHERE run_id = ?', runId).v);
  const spendLedger = r2(-one(`SELECT COALESCE(SUM(amount), 0) AS v FROM cash_ledger WHERE run_id = ? AND entry_type = 'REPLENISHMENT'`, runId).v);
  const closingCash = ledger.length ? ledger[ledger.length - 1].balance_after : 0;
  const expectedCash = r2(openingCash + sumTxn - spendOrders);
  const cash = {
    opening_cash: openingCash, sales_revenue: sumTxn, replenishment_spending: spendOrders,
    expected_closing: expectedCash, closing_cash: closingCash, lowest_balance: Math.min(...ledger.map((l) => l.balance_after))
  };
  add('Cash', 'Closing cash = opening cash + sales revenue - replenishment spending', expectedCash, closingCash, Math.abs(expectedCash - closingCash) < TOL,
    `${openingCash} + ${sumTxn} - ${spendOrders}`);
  add('Cash', 'Opening cash equals the client condition', run.opening_cash, openingCash, Math.abs(openingCash - run.opening_cash) < TOL);
  add('Cash', 'Replenishment spending: orders = cash ledger', spendOrders, spendLedger, Math.abs(spendOrders - spendLedger) < TOL);
  add('Cash', 'Every ledger balance follows from the previous balance', 0, breaks, breaks === 0, 'Count of broken links');
  add('Cash', 'Replenishment never exceeded the cash available when ordered', 0, overspend, overspend === 0);
  add('Cash', 'Cash balance never negative', 0, negative, negative === 0);

  // ---- opening inventory budget
  const openingCost = r2(one('SELECT COALESCE(SUM(initial_qty * unit_cost), 0) AS v FROM run_products WHERE run_id = ?', runId).v);
  add('Budget', 'Opening inventory cost within the client budget', `<= ${run.inventory_budget}`, openingCost, openingCost <= run.inventory_budget);

  const failed = checks.filter((c) => c.status === 'FAIL');
  const notes = [];
  const bc = (t) => one('SELECT COUNT(*) AS n FROM brain_events WHERE run_id = ? AND event_type = ?', runId, t).n;
  notes.push(`${bc('SOLD_OUT')} sold-out events, ${bc('LOW_STOCK')} low-stock events and ${bc('EXPIRY_WRITEOFF')} expiry write-offs are recorded business outcomes, not integrity failures.`);
  notes.push(`${bc('CASH_CONSTRAINED')} orders were constrained by insufficient operating cash.`);

  return {
    overall: failed.length === 0 ? 'PASS' : 'FAIL',
    checks_passed: checks.length - failed.length, checks_total: checks.length,
    checks, exceptions: failed, notes,
    history, inventory: { totals: invTotals, products: prod }, revenue: { total_transactions: sumTxn, total_daily: sumDaily, days: rev }, cash
  };
}

// ---------------------------------------------------------------- written findings

export function getFindings(runId) {
  runRow(runId);
  return all('SELECT * FROM run_findings WHERE run_id = ? ORDER BY finding_no', runId);
}