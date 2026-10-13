import db from './db.js';
import { getSummary, getAssurance, getSubmittedRunId } from './reports.js';

const runId =
  process.argv[2] || db.prepare('SELECT run_id FROM run_completions ORDER BY completed_at DESC LIMIT 1').get()?.run_id;
if (!runId) {
  console.log('No completed run found. Nothing changed.');
  process.exit(1);
}
const already = getSubmittedRunId();
if (already) {
  console.log(`A Submitted Run is already marked (${already}). Nothing changed.`);
  process.exit(1);
}
if (db.prepare('SELECT COUNT(*) AS n FROM run_findings WHERE run_id = ?').get(runId).n > 0) {
  console.log('Findings are already stored for this run. Nothing changed.');
  process.exit(1);
}
const assurance = getAssurance(runId);
if (assurance.overall !== 'PASS') {
  console.log('Commercial Assurance is not PASS for this run. Nothing changed.');
  process.exit(1);
}

// The findings below quote figures from this run. If the stored data differs, stop.
const s = getSummary(runId);
const st = s.part1.store;
const sh = s.part1.shopper;
const inv = s.part2.inventory;
const br = s.part2.brain;
const expected = [
  ['revenue', st.revenue, 355851.5],
  ['COGS', st.cogs, 192261.2],
  ['gross profit', st.gross_profit, 163590.3],
  ['closing cash', st.closing_cash, 191420.35],
  ['write-off value', st.writeoff_value, 1579.7],
  ['closing inventory value', st.closing_inventory_value, 8410.55],
  ['customers', st.customers, 27994],
  ['transactions', st.transactions, 27987],
  ['sold-out events', inv.stockout_events, 120],
  ['low-stock events', inv.low_stock_events, 336],
  ['lost units', inv.lost_units, 321],
  ['lost revenue', inv.lost_revenue, 1746],
  ['cash-constrained events', br.cash_constrained_events, 0],
  ['weekday avg customers', sh.weekday_vs_weekend.weekday.avg_customers, 522.25],
  ['weekend avg customers', sh.weekday_vs_weekend.weekend.avg_customers, 313.44]
];
const mismatches = expected.filter(([, actual, want]) => Math.abs(actual - want) > 0.01);
if (mismatches.length) {
  console.log('This run does not match the figures quoted in the findings. Nothing changed:');
  for (const [name, actual, want] of mismatches) console.log(`  ${name}: stored ${actual}, findings quote ${want}`);
  process.exit(1);
}

const findings = [
  {
    title: 'Cash-generative trading, but the profit depends on assumed margins',
    observation:
      'The store traded profitably and cash was never a problem. Over the 60 days it took A$355,851.50 in sales and made A$163,590.30 of gross profit (45.97%), and operating cash grew from A$15,000 to A$191,420.35. No replenishment order was ever cut back for lack of cash.',
    evidence:
      'Revenue A$355,851.50, COGS A$192,261.20 and gross profit A$163,590.30 across 27,987 transactions. Cash-constrained orders: 0. The lowest balance was A$15,000.00 (the opening balance on Day 1); by the end of Day 1, after that evening\'s orders, cash was already A$20,473, and the biggest single day of order spend was A$6,886.90 (Day 35). Closing inventory is A$8,410.55 (4,155 units), about 2.6 days of cost of goods, and the opening stock used only A$22,820.30 of the A$40,000 budget. Drinks (55.14% margin) and Ready-to-Eat (50.56%) earn about 37% of gross profit from about 32% of revenue, and Household has the lowest margin at 37.25%.',
    diagnosis:
      'Cash was never short because stock turns over in about 2.6 days and each day\'s sales are banked before that evening\'s orders are paid, so the A$15,000 only had to carry the very first days. The result therefore rests mainly on the price and cost assumptions: the blended margin of 46% is well above what a large supermarket usually earns and comes from convenience-style pricing, mostly in drinks and ready-to-eat food.',
    implication:
      'On this evidence the client does not need more working capital than A$15,000, and the cash surplus keeps building. But gross profit is not take-home profit. Rent, hardware, utilities, insurance and overheads are outside the model, so A$163,590 cannot be read as what the store would earn, and a lower real margin on drinks and ready-to-eat food would hit profit hardest.',
    recommendation:
      'Keep operating cash at A$15,000 for now. Before spending more on the prototype, replace the assumed costs and prices for the Drinks and Ready-to-Eat lines with real supplier quotes and nearby shelf prices, then re-run the model with rent, utilities and delivery charges added to see what margin the site needs to break even.',
    limitation:
      'Prices and costs are modelling assumptions, not market data. Suppliers always deliver in full the next day with no minimum order or delivery charge, even though the Store Brain places about 57 order lines a day (3,388 in total). There is no theft or damage, and gross profit ignores all overheads.'
  },
  {
    title: 'Short shelf-life lunch items both run out and expire',
    observation:
      'Almost all the operating problems sit in six short-life lines. Of 76 products only 9 ever sold out, and Butter Croissant, Chicken Sandwich, Ham & Cheese Toastie, Sushi Pack 8pc, Garden Salad Bowl and Fruit Cup 200g account for 117 of the 120 sold-out events. The same two categories, Ready-to-Eat and Fresh & Bakery, carry all of the A$1,579.70 written off.',
    evidence:
      'Sold-out days: Butter Croissant 21, Chicken Sandwich 21, Garden Salad Bowl 20, Fruit Cup 20, Sushi Pack 18, Ham & Cheese Toastie 17. Demand lost: 321 units worth A$1,746.00 (Ready-to-Eat 256 units, Fresh & Bakery 64 units). Write-offs: 479 units, A$1,579.70, of which Sushi Pack 302 units (A$1,147.60, about 73%), Beef Pie 47 units, Sourdough Loaf 32 units and Chicken Sandwich 28 units. The Sushi Pack has a one-day shelf life and both sold out on 18 days and expired 302 packs. The other 70 products had only 3 sold-out events between them.',
    diagnosis:
      'These items live one to three days, but the Store Brain can only order after close for the next morning, using the last seven days of sales. A one-day item such as the Sushi Pack can only be sold on the day it arrives, so each order is a single bet on that day\'s demand. For the Sushi Pack a missed sale costs A$3.70 of margin (A$7.50 price less A$3.80 cost) and an unsold pack costs A$3.80, almost the same, so ordering close to expected demand will sooner or later miss on both sides, which matches 18 sold-out days and 302 expired packs. This is the rules working as designed, not a fault in the records.',
    implication:
      'The money is small, A$3,325.70 or about 0.9% of revenue (A$1,746.00 of lost sales plus A$1,579.70 of write-offs), but it lands on the lunch products customers buy at the busiest time of day. Chicken Sandwich and Sushi Pack are the second and fourth best sellers by revenue (A$12,707.50 and A$11,520.00), and 12:00 is the peak hour at about 51 customers a day. With nobody in the store, a customer who finds the lunch item gone gets no help, so repeated misses on these lines are a service risk that the lost-sales figure may understate.',
    recommendation:
      'Trial a fix on these six lines only. Give each its own order quantity by day of week instead of the shared weekday and weekend factor, and test a late-afternoon markdown on the one-day Sushi Pack so unsold packs sell at a lower margin instead of expiring at A$3.80 each. Judge the trial against this run\'s A$1,746.00 of lost sales and A$1,579.70 of write-offs, and leave the rest of the Store Brain unchanged.',
    limitation:
      'When an item is out, 35% of customers switch to another product in the same category and the rest simply go without. That rate is an assumption, and the model has no repeat-visit or loyalty effect, so real losses could be higher. Markdowns are not implemented, so the markdown idea is a test to run and not a proven gain.'
  },
  {
    title: 'Revenue depends on trip type and time of day, not just footfall',
    observation:
      'The store is busiest on weekdays around lunch and after work, but the money comes from a smaller number of larger resident trips. Weekends have 40% fewer customers than weekdays but only about 37% less revenue.',
    evidence:
      'Weekdays average 522 customers and A$6,576 of revenue a day, weekends 313 customers and A$4,156. The busiest hours are 12:00 (51 customers a day), 17:00 (45) and 13:00 (45). Resident customers are 27.5% of customers but bring about 43% of revenue (A$19.94 a customer against A$10.54 for office workers). Stock-up trips are 4.5% of trips but 16% of revenue, while snack and drink trips are about 37% of trips but only 20% of revenue. Day 20 (the declared festival Saturday) had 472 customers and A$5,670, against 284 to 359 customers and A$3,779 to A$4,882 on the other Saturdays. In the Day 31 to 33 heatwave, Drinks revenue was A$2,069, A$2,026 and A$1,659 a day against A$1,057 and A$1,306 on the Monday and Tuesday before, and Drinks had no sold-out events in the whole run.',
    diagnosis:
      'Footfall and revenue are not the same thing. Resident top-up and stock-up shopping brings roughly twice the spend per customer of the short office-worker snack and lunch trips, so a quieter weekend loses fewer dollars than customers. The Store Brain coped with the heatwave without a single sold-out drink line because its demand estimate follows the last seven days of sales.',
    implication:
      'About 43% of revenue rests on one customer group and its larger-basket trips. If the real catchment has fewer residents than assumed, revenue will fall faster than footfall suggests, and a missing staple on a stock-up trip costs more than a missing snack.',
    recommendation:
      'Put availability of the resident top-up and stock-up range first (dairy, bread, fresh produce, pantry and household staples), and use the first weeks of real trading to measure who shops, when, and how much they spend. Replace the assumed customer mix with those counts before the model is used for any investment decision.',
    limitation:
      'The customer types, hourly profiles and shopping missions are declared assumptions, so these patterns are an output of the model and not market evidence. Conversion is 99.97% (7 of 27,994 customers left without buying) because every simulated arrival comes with a shopping mission. Customers here means shoppers who intend to buy, so real door counts would be higher.'
  }
];

const insertFinding = db.prepare(
  'INSERT INTO run_findings (run_id, finding_no, title, observation, evidence, diagnosis, implication, recommendation, limitation) VALUES (?,?,?,?,?,?,?,?,?)'
);
const markSubmitted = db.prepare('INSERT INTO submitted_run (id, run_id, marked_at) VALUES (1, ?, ?)');

db.transaction(() => {
  findings.forEach((f, i) =>
    insertFinding.run(runId, i + 1, f.title, f.observation, f.evidence, f.diagnosis, f.implication, f.recommendation, f.limitation)
  );
  markSubmitted.run(runId, new Date().toISOString());
})();

console.log(`Stored ${findings.length} findings and marked ${runId} as the Submitted Run.`);
console.log(`Checked ${expected.length} quoted figures against the stored data: all match.`);