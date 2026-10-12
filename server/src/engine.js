// Simulation engine: runs one complete 60-day operating history and stores it in SQLite.
// Daily cycle: morning receipts + expiry -> customers and sales -> close of day cash
// -> Store Brain reviews closing state -> replenishment orders (arrive next morning).

import {
    MODEL_CONFIG, NUM_DAYS, TRADING_HOURS, BASE_CUSTOMERS, DAILY_NOISE_SD, SUBSTITUTE_PROB,
    CUSTOMER_TYPES, MISSIONS, EVENTS, dayType, createRng, randNormal, randPoisson, weightedPick
  } from './model.js';
  import { PRODUCTS, INVENTORY_BUDGET, OPENING_CASH } from './catalogue.js';
  
  const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
  
  // Placeholder brain used only to test the engine: it never orders anything.
  export const noBrain = {
    CONFIG: { name: 'no-brain', description: 'No autonomous actions (engine test only)' },
    review: () => ({ events: [], orders: [] })
  };
  
  function makeRunId(seed) {
    const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    return `RUN-${stamp}-${(seed % 46656).toString(36).toUpperCase().padStart(3, '0')}`;
  }
  
  export function runSimulation({ db, brain = noBrain, seed, label = 'Simulation run' } = {}) {
    if (!db) throw new Error('runSimulation needs a database');
    if (seed === undefined) seed = Math.floor(Math.random() * 2147483647);
  
    const openingCost = round2(PRODUCTS.reduce((s, p) => s + p.unit_cost * p.initial_qty, 0));
    if (openingCost > INVENTORY_BUDGET) {
      throw new Error(`Opening inventory A$${openingCost} exceeds the A$${INVENTORY_BUDGET} budget`);
    }
  
    const rng = createRng(seed);
    const runId = makeRunId(seed);
  
    const ins = {
      run: db.prepare('INSERT INTO runs (run_id,label,created_at,seed,opening_cash,inventory_budget,num_days,config_json) VALUES (?,?,?,?,?,?,?,?)'),
      product: db.prepare('INSERT INTO run_products (run_id,product_id,name,category,unit_cost,unit_price,initial_qty,perishable,shelf_life_days,popularity) VALUES (?,?,?,?,?,?,?,?,?,?)'),
      lot: db.prepare('INSERT INTO inventory_lots (run_id,product_id,received_day,expiry_day,qty_received,unit_cost) VALUES (?,?,?,?,?,?)'),
      move: db.prepare('INSERT INTO inventory_movements (run_id,day,product_id,lot_id,movement_type,qty,ref_id) VALUES (?,?,?,?,?,?,?)'),
      visit: db.prepare('INSERT INTO customer_visits (run_id,day,hour,customer_type,mission,items_wanted,items_bought,outcome) VALUES (?,?,?,?,?,?,?,?)'),
      txn: db.prepare('INSERT INTO transactions (run_id,day,hour,visit_id,units,total,cogs) VALUES (?,?,?,?,?,?,?)'),
      item: db.prepare('INSERT INTO transaction_items (txn_id,run_id,day,product_id,qty,unit_price,unit_cost,line_total) VALUES (?,?,?,?,?,?,?,?)'),
      lost: db.prepare('INSERT INTO lost_sales (run_id,day,hour,visit_id,product_id,qty,reason) VALUES (?,?,?,?,?,?,?)'),
      order: db.prepare('INSERT INTO replenishment_orders (run_id,day_placed,day_due,product_id,requested_qty,ordered_qty,unit_cost,line_cost,reason) VALUES (?,?,?,?,?,?,?,?,?)'),
      cash: db.prepare('INSERT INTO cash_ledger (run_id,day,entry_type,amount,balance_after,ref_id) VALUES (?,?,?,?,?,?)'),
      brain: db.prepare('INSERT INTO brain_events (run_id,day,event_type,product_id,detail,action_taken,ref_order_id) VALUES (?,?,?,?,?,?,?)'),
      done: db.prepare('INSERT INTO run_completions (run_id,completed_at,days_completed) VALUES (?,?,?)')
    };
  
    const execute = db.transaction(() => {
      // ---- freeze configuration ----
      const config = {
        model: MODEL_CONFIG,
        brain: brain.CONFIG,
        opening: { cash: OPENING_CASH, inventoryBudget: INVENTORY_BUDGET, openingInventoryCost: openingCost }
      };
      ins.run.run(runId, label, new Date().toISOString(), seed, OPENING_CASH, INVENTORY_BUDGET, NUM_DAYS, JSON.stringify(config));
  
      // ---- in-memory working state (every change is also written to SQLite) ----
      const state = new Map();
      const catProducts = {};
      for (const d of PRODUCTS) {
        ins.product.run(runId, d.product_id, d.name, d.category, d.unit_cost, d.unit_price, d.initial_qty, d.perishable ? 1 : 0, d.shelf_life_days, d.popularity);
        state.set(d.product_id, { def: d, lots: [], onHand: 0, soldHist: [], lostHist: [], today: null });
        (catProducts[d.category] ||= []).push([d.product_id, d.popularity]);
      }
  
      const sortLots = (st) =>
        st.lots.sort((a, b) => (a.expiry_day ?? 1e9) - (b.expiry_day ?? 1e9) || a.lot_id - b.lot_id);
  
      function addLot(st, day, qty, moveType, refId) {
        const d = st.def;
        const expiry = d.perishable ? day + d.shelf_life_days : null;
        const info = ins.lot.run(runId, d.product_id, day, expiry, qty, d.unit_cost);
        const lot = { lot_id: Number(info.lastInsertRowid), qty, expiry_day: expiry };
        ins.move.run(runId, day, d.product_id, lot.lot_id, moveType, qty, refId);
        st.lots.push(lot);
        sortLots(st);
        st.onHand += qty;
      }
  
      function takeFromLots(st, qty, day, txnId) {
        let remaining = qty;
        for (const lot of st.lots) {
          if (remaining === 0) break;
          if (lot.qty === 0) continue;
          const take = Math.min(lot.qty, remaining);
          lot.qty -= take;
          remaining -= take;
          st.onHand -= take;
          ins.move.run(runId, day, st.def.product_id, lot.lot_id, 'SALE', -take, txnId);
        }
        st.lots = st.lots.filter((l) => l.qty > 0);
      }
  
      // ---- opening position (start of Day 1) ----
      for (const st of state.values()) addLot(st, 1, st.def.initial_qty, 'OPENING', null);
      let cash = OPENING_CASH;
      ins.cash.run(runId, 1, 'OPENING', OPENING_CASH, cash, null);
      let pending = [];
  
      const sumHourly = {};
      for (const [t, cfg] of Object.entries(CUSTOMER_TYPES)) {
        sumHourly[t] = cfg.hourly.reduce((a, b) => a + b, 0);
      }
  
      for (let day = 1; day <= NUM_DAYS; day++) {
        // 1. Morning: receive yesterday's orders, then remove expired stock.
        for (const o of pending.filter((x) => x.day_due === day)) {
          addLot(state.get(o.product_id), day, o.qty, 'RECEIPT', o.order_id);
        }
        pending = pending.filter((x) => x.day_due > day);
  
        for (const st of state.values()) {
          st.today = { sold: 0, lost: 0, stockoutHour: null };
          let expiredQty = 0;
          for (const lot of st.lots) {
            if (lot.expiry_day !== null && lot.expiry_day <= day && lot.qty > 0) {
              ins.move.run(runId, day, st.def.product_id, lot.lot_id, 'EXPIRY', -lot.qty, null);
              expiredQty += lot.qty;
              st.onHand -= lot.qty;
              lot.qty = 0;
            }
          }
          if (expiredQty > 0) {
            st.lots = st.lots.filter((l) => l.qty > 0);
            ins.brain.run(
              runId, day, 'EXPIRY_WRITEOFF', st.def.product_id,
              `${expiredQty} units (A$${round2(expiredQty * st.def.unit_cost).toFixed(2)} at cost) reached expiry`,
              'Removed from sale and written off before opening', null
            );
          }
          if (st.onHand === 0) st.today.stockoutHour = TRADING_HOURS[0];
        }
  
        // 2. Today's demand: customers per day, type shares, events.
        const dtype = dayType(day);
        const todaysEvents = EVENTS.filter((e) => e.days.includes(day));
        let expected = BASE_CUSTOMERS[dtype];
        for (const e of todaysEvents) expected *= e.customerMultiplier;
        const dayCustomers = Math.max(0, expected * (1 + DAILY_NOISE_SD * randNormal(rng)));
  
        const shares = {};
        let totalShare = 0;
        for (const [t, cfg] of Object.entries(CUSTOMER_TYPES)) {
          let s = dtype === 'weekday' ? cfg.shareWeekday : cfg.shareWeekend;
          for (const e of todaysEvents) s *= e.typeShareMultiplier?.[t] ?? 1;
          shares[t] = s;
          totalShare += s;
        }
        const catMult = {};
        for (const e of todaysEvents) {
          for (const [c, m] of Object.entries(e.categoryMultiplier || {})) catMult[c] = (catMult[c] ?? 1) * m;
        }
        const missionCats = {};
        for (const [m, mc] of Object.entries(MISSIONS)) {
          missionCats[m] = Object.entries(mc.categoryWeights).map(([c, w]) => [c, w * (catMult[c] ?? 1)]);
        }
  
        let dayRevenue = 0;
  
        // 3. Customers arrive hour by hour.
        TRADING_HOURS.forEach((hour, i) => {
          for (const [typeKey, cfg] of Object.entries(CUSTOMER_TYPES)) {
            const mean = (dayCustomers * (shares[typeKey] / totalShare) * cfg.hourly[i]) / sumHourly[typeKey];
            const n = randPoisson(rng, mean);
            for (let k = 0; k < n; k++) {
              // mission
              const missionEntries = Object.entries(cfg.missions).map(([m, w]) => [m, w * (MISSIONS[m].hourFactor ? MISSIONS[m].hourFactor[i] : 1)]);
              const mission = weightedPick(rng, missionEntries);
              const mc = MISSIONS[mission];
  
              // wanted basket
              const lines = 1 + randPoisson(rng, Math.max(0, mc.meanItems - 1));
              const chosen = new Set();
              const wants = [];
              for (let l = 0; l < lines; l++) {
                let pid = null;
                for (let attempt = 0; attempt < 6; attempt++) {
                  const cat = weightedPick(rng, missionCats[mission]);
                  const cand = weightedPick(rng, catProducts[cat]);
                  if (!chosen.has(cand)) { pid = cand; break; }
                }
                if (pid === null) continue;
                chosen.add(pid);
                let qty = 1;
                if (rng() < mc.multiBuyProb) qty += rng() < 0.7 ? 1 : 2;
                wants.push({ pid, qty });
              }
  
              // what the store can actually sell
              const bought = [];
              const lostLines = [];
              for (const w of wants) {
                const wantedSt = state.get(w.pid);
                let target = wantedSt;
                if (wantedSt.onHand === 0) {
                  let subId = null;
                  if (rng() < SUBSTITUTE_PROB) {
                    const options = catProducts[wantedSt.def.category].filter(([id]) => !chosen.has(id) && state.get(id).onHand > 0);
                    if (options.length) subId = weightedPick(rng, options);
                  }
                  if (subId) {
                    chosen.add(subId);
                    target = state.get(subId);
                    lostLines.push({ pid: w.pid, qty: w.qty, reason: 'SUBSTITUTED' });
                  } else {
                    lostLines.push({ pid: w.pid, qty: w.qty, reason: 'OUT_OF_STOCK' });
                    continue;
                  }
                }
                const take = Math.min(w.qty, target.onHand);
                if (take < w.qty && target === wantedSt) {
                  lostLines.push({ pid: w.pid, qty: w.qty - take, reason: 'PARTIAL_STOCK' });
                }
                bought.push({ st: target, qty: take });
              }
  
              const outcome = bought.length > 0 ? 'PURCHASED' : 'WALKED_OUT';
              const visitId = Number(ins.visit.run(runId, day, hour, typeKey, mission, wants.length, bought.length, outcome).lastInsertRowid);
  
              for (const lo of lostLines) {
                ins.lost.run(runId, day, hour, visitId, lo.pid, lo.qty, lo.reason);
                state.get(lo.pid).today.lost += lo.qty;
              }
  
              if (bought.length === 0) continue;
  
              // transaction
              let units = 0;
              let total = 0;
              let cogs = 0;
              const lineTotals = bought.map((b) => {
                const lt = round2(b.qty * b.st.def.unit_price);
                units += b.qty;
                total += lt;
                cogs += b.qty * b.st.def.unit_cost;
                return lt;
              });
              total = round2(total);
              cogs = round2(cogs);
              const txnId = Number(ins.txn.run(runId, day, hour, visitId, units, total, cogs).lastInsertRowid);
              bought.forEach((b, idx) => {
                takeFromLots(b.st, b.qty, day, txnId);
                ins.item.run(txnId, runId, day, b.st.def.product_id, b.qty, b.st.def.unit_price, b.st.def.unit_cost, lineTotals[idx]);
                b.st.today.sold += b.qty;
                if (b.st.onHand === 0 && b.st.today.stockoutHour === null) b.st.today.stockoutHour = hour;
              });
              dayRevenue += total;
            }
          }
        });
  
        // 4. Close of day: bank the sales, then the Store Brain reviews.
        dayRevenue = round2(dayRevenue);
        cash = round2(cash + dayRevenue);
        ins.cash.run(runId, day, 'SALES', dayRevenue, cash, null);
  
        for (const st of state.values()) {
          st.soldHist.push(st.today.sold);
          st.lostHist.push(st.today.lost);
        }
  
        const view = {
          day,
          numDays: NUM_DAYS,
          canOrder: day < NUM_DAYS,
          cash,
          products: [...state.values()].map((st) => ({
            product_id: st.def.product_id,
            name: st.def.name,
            category: st.def.category,
            unit_cost: st.def.unit_cost,
            unit_price: st.def.unit_price,
            perishable: st.def.perishable,
            shelf_life_days: st.def.shelf_life_days,
            on_hand: st.onHand,
            lots: st.lots.map((l) => ({ qty: l.qty, expiry_day: l.expiry_day })),
            sold_today: st.today.sold,
            lost_today: st.today.lost,
            stockout_hour: st.today.stockoutHour,
            sold_history: st.soldHist.slice(),
            lost_history: st.lostHist.slice()
          }))
        };
  
        const decision = brain.review(view) || {};
        for (const e of decision.events || []) {
          ins.brain.run(runId, day, e.event_type, e.product_id ?? null, e.detail, e.action_taken, null);
        }
  
        const orders = decision.orders || [];
        if (!view.canOrder && orders.length > 0) throw new Error('Brain tried to order after the final day');
  
        for (const o of orders) {
          const d = state.get(o.product_id).def;
          if (o.ordered_qty < o.requested_qty) {
            ins.brain.run(
              runId, day, 'CASH_CONSTRAINED', o.product_id,
              `Wanted ${o.requested_qty} units (A$${round2(o.requested_qty * d.unit_cost).toFixed(2)}) but only A$${cash.toFixed(2)} cash was available`,
              o.ordered_qty > 0 ? `Reduced order to ${o.ordered_qty} units` : 'No order placed', null
            );
          }
          if (o.ordered_qty <= 0) continue;
          const cost = round2(o.ordered_qty * d.unit_cost);
          if (cost > cash + 1e-9) throw new Error(`Brain exceeded available cash on day ${day}`);
          cash = round2(cash - cost);
          const orderId = Number(ins.order.run(runId, day, day + 1, o.product_id, o.requested_qty, o.ordered_qty, d.unit_cost, cost, o.reason).lastInsertRowid);
          ins.cash.run(runId, day, 'REPLENISHMENT', -cost, cash, orderId);
          ins.brain.run(
            runId, day, 'REPLENISH', o.product_id, o.reason,
            `Ordered ${o.ordered_qty} units for A$${cost.toFixed(2)}, arrives Day ${day + 1}`, orderId
          );
          pending.push({ order_id: orderId, day_due: day + 1, product_id: o.product_id, qty: o.ordered_qty });
        }
      }
  
      ins.done.run(runId, new Date().toISOString(), NUM_DAYS);
      return cash;
    });
  
    const closingCash = execute();
    return { runId, seed, closingCash };
  }