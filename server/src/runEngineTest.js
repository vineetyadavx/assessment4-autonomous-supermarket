import Database from 'better-sqlite3';
import { initSchema } from './schema.js';
import { runSimulation, noBrain } from './engine.js';
import { createBrain } from './brain.js';
import { dayType } from './model.js';

const db = new Database(':memory:');
db.pragma('foreign_keys = ON');
initSchema(db);

const t0 = Date.now();
const brain = process.argv[2] === 'brain' ? createBrain() : noBrain;
const { runId, closingCash } = runSimulation({ db, brain, seed: 12345, label: 'engine test' });
const ms = Date.now() - t0;

const get = (sql) => db.prepare(sql).get(runId);
const all = (sql) => db.prepare(sql).all(runId);

const visits = get('SELECT COUNT(*) AS n, SUM(outcome=\'PURCHASED\') AS bought FROM customer_visits WHERE run_id=?');
const tx = get('SELECT COUNT(*) AS n, SUM(units) AS units, ROUND(SUM(total),2) AS revenue, ROUND(SUM(cogs),2) AS cogs FROM transactions WHERE run_id=?');
const items = get('SELECT ROUND(SUM(line_total),2) AS revenue FROM transaction_items WHERE run_id=?');
const moves = Object.fromEntries(all('SELECT movement_type AS t, SUM(qty) AS q FROM inventory_movements WHERE run_id=? GROUP BY movement_type').map((r) => [r.t, r.q]));
const writeoff = get('SELECT ROUND(-SUM(m.qty*p.unit_cost),2) AS v FROM inventory_movements m JOIN run_products p ON p.run_id=m.run_id AND p.product_id=m.product_id WHERE m.run_id=? AND m.movement_type=\'EXPIRY\'');
const lost = get('SELECT SUM(qty) AS q FROM lost_sales WHERE run_id=? AND reason != \'SUBSTITUTED\'');
const negProduct = get('SELECT COUNT(*) AS n FROM (SELECT product_id, SUM(qty) AS s FROM inventory_movements WHERE run_id=? GROUP BY product_id HAVING s < 0)');
const negLot = get('SELECT COUNT(*) AS n FROM (SELECT lot_id, SUM(qty) AS s FROM inventory_movements WHERE run_id=? GROUP BY lot_id HAVING s < 0)');
const expiredSales = get('SELECT COUNT(*) AS n FROM inventory_movements m JOIN inventory_lots l ON l.lot_id=m.lot_id WHERE m.run_id=? AND m.movement_type=\'SALE\' AND l.expiry_day IS NOT NULL AND m.day >= l.expiry_day');
const perDay = all('SELECT day, COUNT(*) AS c FROM customer_visits WHERE run_id=? GROUP BY day');

const byType = { weekday: [], saturday: [], sunday: [] };
for (const r of perDay) byType[dayType(r.day)].push(r.c);
const avg = (a) => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : 0);
const closingUnits = (moves.OPENING || 0) + (moves.RECEIPT || 0) + (moves.SALE || 0) + (moves.EXPIRY || 0);

console.log(`Run ${runId} finished in ${ms} ms`);
console.log(`Customers: ${visits.n} (purchased ${visits.bought}, walked out ${visits.n - visits.bought})`);
console.log(`Avg customers/day  weekday ${avg(byType.weekday)}  saturday ${avg(byType.saturday)}  sunday ${avg(byType.sunday)}`);
console.log(`Transactions: ${tx.n}  units: ${tx.units}  revenue: A$${tx.revenue}  COGS: A$${tx.cogs}`);
console.log(`Revenue from line items: A$${items.revenue} (should equal transaction revenue)`);
console.log(`Write-off value: A$${writeoff.v ?? 0}   lost units (stockouts): ${lost.q ?? 0}`);
console.log(`Units: opening ${moves.OPENING} + receipts ${moves.RECEIPT || 0} - sold ${-moves.SALE} - expired ${-(moves.EXPIRY || 0)} = closing ${closingUnits}`);
console.log(`Closing cash: A$${closingCash.toFixed(2)}`);
console.log(`Negative stock products: ${negProduct.n}, negative lots: ${negLot.n}, sales of expired stock: ${expiredSales.n}`);

try {
  db.prepare('UPDATE transactions SET total = 0 WHERE run_id = ?').run(runId);
  console.log('PROBLEM: history could be edited');
} catch (e) {
  console.log('Append-only check: edit blocked ->', e.message);
}

const ev = all('SELECT event_type AS t, COUNT(*) AS n FROM brain_events WHERE run_id=? GROUP BY event_type ORDER BY n DESC');
console.log('Store Brain events: ' + (ev.map((e) => e.t + '=' + e.n).join(', ') || 'none'));
const ord = get('SELECT COUNT(*) AS n, ROUND(SUM(line_cost),2) AS spend FROM replenishment_orders WHERE run_id=?');
console.log('Replenishment orders: ' + ord.n + ', spend A$' + (ord.spend ?? 0));
const net = get('SELECT ROUND(SUM(amount),2) AS v FROM cash_ledger WHERE run_id=?');
console.log('Cash ledger total: A$' + net.v + ' (should equal closing cash)');
const minCash = get('SELECT MIN(balance_after) AS v FROM cash_ledger WHERE run_id=?');
console.log('Lowest cash balance: A$' + minCash.v);
