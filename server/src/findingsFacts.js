import db from './db.js';
import { getSummary, getAssurance } from './reports.js';

const runId = process.argv[2] || db.prepare('SELECT run_id FROM run_completions ORDER BY completed_at DESC LIMIT 1').get()?.run_id;
if (!runId) {
  console.log('No completed run found');
  process.exit(1);
}
const s = getSummary(runId);
const a = getAssurance(runId);
const p1 = s.part1;
const p2 = s.part2;
const st = p1.store;
const sh = p1.shopper;
const inv = p2.inventory;
const brain = p2.brain;
const m = (n) => 'A$' + Number(n).toFixed(2);
const all = (sql, ...p) => db.prepare(sql).all(...p);
const one = (sql, ...p) => db.prepare(sql).get(...p);
const L = (...x) => console.log(...x);

L('RUN', runId, '| assurance', a.overall, `${a.checks_passed}/${a.checks_total}`);
L('\n== STORE ==');
L('customers', st.customers, 'bought', st.purchasing_customers, 'transactions', st.transactions, 'units', st.units_sold);
L('revenue', m(st.revenue), 'cogs', m(st.cogs), 'gross profit', m(st.gross_profit), st.gross_margin_pct + '%');
L('writeoff', st.writeoff_units, 'units', m(st.writeoff_value), '| closing cash', m(st.closing_cash), '| closing inventory', st.closing_inventory_units, 'units', m(st.closing_inventory_value));
L('inventory days of cover at close:', (st.closing_inventory_value / (st.cogs / 60)).toFixed(1));

L('\n== SHOPPERS ==');
L('avg customers/day', sh.avg_customers_per_day, 'conversion', sh.conversion_pct + '%', 'basket units', sh.avg_basket_units, 'avg txn', m(sh.avg_transaction_value));
const wd = sh.weekday_vs_weekend;
L('weekday avg customers', wd.weekday.avg_customers, 'revenue', m(wd.weekday.avg_revenue), '| weekend avg customers', wd.weekend.avg_customers, 'revenue', m(wd.weekend.avg_revenue));
L('best day', sh.best_day.day, sh.best_day.weekday, m(sh.best_day.revenue), '| worst day', sh.worst_day.day, sh.worst_day.weekday, m(sh.worst_day.revenue));
L('Saturdays:', p1.daily.filter((d) => d.weekday === 'Sat').map((d) => `D${d.day}=${d.customers} cust/${Math.round(d.revenue)}`).join('  '));
L('Drinks revenue days 27-37:', all(`SELECT i.day, ROUND(SUM(i.line_total),0) AS v FROM transaction_items i JOIN run_products p ON p.run_id=i.run_id AND p.product_id=i.product_id WHERE i.run_id=? AND p.category='Drinks' AND i.day BETWEEN 27 AND 37 GROUP BY i.day ORDER BY i.day`, runId).map((r) => `D${r.day}=${r.v}`).join('  '));
L('top hours (avg customers/day):', [...p1.hourly].sort((x, y) => y.avg_customers_per_day - x.avg_customers_per_day).slice(0, 4).map((h) => `${h.hour}:00=${h.avg_customers_per_day}`).join('  '));
L('by type:', p1.byCustomerType.map((x) => `${x.name} ${x.customers} cust ${m(x.revenue)}`).join(' | '));
L('by mission:', p1.byMission.map((x) => `${x.name} ${x.customers} cust ${m(x.revenue)}`).join(' | '));

L('\n== CATEGORIES (revenue, share, margin, gross profit) ==');
for (const c of p1.categories) L(c.category.padEnd(24), m(c.revenue).padStart(13), c.share_of_revenue_pct + '%', c.margin_pct + '%', m(c.gross_profit));
L('top 5 products by revenue:', p1.topProducts.slice(0, 5).map((x) => `${x.name} ${m(x.revenue)} (${x.units_sold}u)`).join(' | '));
L('weakest 6 by units:', p1.weakProducts.slice(0, 6).map((x) => `${x.name} ${x.units_sold}u ${x.avg_units_per_day}/day`).join(' | '));

L('\n== STOCKOUTS ==');
L('sold-out events', inv.stockout_events, 'low-stock events', inv.low_stock_events, 'lost units', inv.lost_units, 'lost revenue', m(inv.lost_revenue));
L('lost revenue as % of (revenue + lost):', ((inv.lost_revenue / (st.revenue + inv.lost_revenue)) * 100).toFixed(2) + '%');
L('customers who left empty-handed:', st.customers - st.purchasing_customers);
L('sold-out events by category:', all(`SELECT p.category, COUNT(*) AS n FROM brain_events e JOIN run_products p ON p.run_id=e.run_id AND p.product_id=e.product_id WHERE e.run_id=? AND e.event_type='SOLD_OUT' GROUP BY p.category ORDER BY n DESC`, runId).map((r) => `${r.category} ${r.n}`).join(' | '));
L('lost sales by category:', all(`SELECT p.category, SUM(l.qty) AS u, ROUND(SUM(l.qty*p.unit_price),0) AS r FROM lost_sales l JOIN run_products p ON p.run_id=l.run_id AND p.product_id=l.product_id WHERE l.run_id=? AND l.reason!='SUBSTITUTED' GROUP BY p.category ORDER BY r DESC`, runId).map((r) => `${r.category} ${r.u}u ${m(r.r)}`).join(' | '));
L('sold-out events perishable vs not:', all(`SELECT p.perishable AS x, COUNT(*) AS n FROM brain_events e JOIN run_products p ON p.run_id=e.run_id AND p.product_id=e.product_id WHERE e.run_id=? AND e.event_type='SOLD_OUT' GROUP BY p.perishable`, runId).map((r) => `${r.x ? 'perishable' : 'non-perishable'} ${r.n}`).join(' | '));
L('distinct products that sold out:', one(`SELECT COUNT(DISTINCT product_id) AS n FROM brain_events WHERE run_id=? AND event_type='SOLD_OUT'`, runId).n, 'of', s.products.length);
L('top sold-out products:', inv.soldOutTop.slice(0, 6).map((x) => `${x.name} (${x.category}) ${x.sold_out_days} days, ${x.lost_units} lost`).join(' | '));

L('\n== EXPIRY ==');
L('by category:', inv.expiryByCategory.map((x) => `${x.category} ${x.units}u ${m(x.value)}`).join(' | '));
L('top products:', inv.expiryByProduct.slice(0, 6).map((x) => `${x.name} ${x.units}u ${m(x.value)} (shelf ${x.shelf_life_days}d)`).join(' | '));
const per = s.products.filter((p) => p.perishable);
const perCogs = per.reduce((t, p) => t + p.revenue - p.gross_profit, 0);
L('perishable revenue', m(per.reduce((t, p) => t + p.revenue, 0)), 'perishable COGS', m(perCogs), 'writeoff as % of perishable COGS', ((st.writeoff_value / perCogs) * 100).toFixed(2) + '%', '| as % of revenue', ((st.writeoff_value / st.revenue) * 100).toFixed(2) + '%');

L('\n== SLOW MOVERS ==');
const slow = {};
for (const e of brain.slowMovers) (slow[e.product_id] ||= { name: e.name, n: 0, first: e.day, last: e.detail }).n += 1;
for (const [id, x] of Object.entries(slow)) {
  const p = s.products.find((q) => q.product_id === id);
  L(`${x.name}: flagged ${x.n}x, first Day ${x.first}, ${p.avg_units_per_day}/day sold, closing ${p.closing_units} units (${m(p.closing_value)}), gross profit ${m(p.gross_profit)}`);
}
L('total slow-mover events', brain.slowMovers.length);

L('\n== CASH AND REPLENISHMENT ==');
L('opening', m(st.opening_cash), 'closing', m(st.closing_cash), 'lowest balance', brain.lowest_cash && `${m(brain.lowest_cash.balance)} (Day ${brain.lowest_cash.day})`);
L('peak one-day order spend', brain.peak_daily_spend && `${m(brain.peak_daily_spend.spend)} (Day ${brain.peak_daily_spend.day})`, '| cash-constrained orders', brain.cash_constrained_events);
L('replenishment total', m(inv.replenishment.spend), inv.replenishment.units, 'units', inv.replenishment.orders, 'order lines (avg ' + (inv.replenishment.orders / 59).toFixed(1) + ' lines/day)');
L('end-of-day cash after orders:', [1, 2, 5, 10, 20, 30, 45, 59, 60].map((d) => `D${d}=${Math.round(one('SELECT balance_after AS b FROM cash_ledger WHERE run_id=? AND day=? ORDER BY entry_id DESC LIMIT 1', runId, d).b)}`).join('  '));
L('brain events:', brain.counts.map((c) => `${c.event_type}=${c.events}`).join(', '));