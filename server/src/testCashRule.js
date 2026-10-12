import { createBrain } from './brain.js';

const hist = (n, v) => Array(n).fill(v);
const mk = (id, name, cost, price, onHand, sold, lost, stockoutHour) => ({
  product_id: id,
  name,
  category: 'Test',
  unit_cost: cost,
  unit_price: price,
  perishable: false,
  shelf_life_days: null,
  on_hand: onHand,
  lots: onHand > 0 ? [{ qty: onHand, expiry_day: null }] : [],
  sold_today: sold,
  lost_today: lost,
  stockout_hour: stockoutHour,
  sold_history: hist(10, sold),
  lost_history: hist(10, lost)
});

const products = [
  mk('A', 'Sold-out item', 1.0, 2.0, 0, 30, 5, 11),
  mk('B', 'Low-stock item', 2.0, 4.0, 10, 20, 0, null),
  mk('C', 'Routine item', 1.5, 3.0, 40, 10, 0, null)
];
const cost = Object.fromEntries(products.map((p) => [p.product_id, p.unit_cost]));

let failed = false;
const check = (label, ok) => {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label);
  if (!ok) failed = true;
};

// Test 1: only A$60 of cash available on Day 10
const r1 = createBrain().review({ day: 10, numDays: 60, canOrder: true, cash: 60, products });
let spend = 0;
for (const o of r1.orders) {
  spend += o.ordered_qty * cost[o.product_id];
  console.log(`  ${o.product_id}: requested ${o.requested_qty}, ordered ${o.ordered_qty}`);
}
console.log(`  total spend A$${spend.toFixed(2)} of A$60.00 cash`);
check('spend never exceeds available cash', spend <= 60 + 1e-9);
const a = r1.orders.find((o) => o.product_id === 'A');
check('sold-out product is funded first', a && a.ordered_qty > 0);
check('at least one order was cut back by the cash limit', r1.orders.some((o) => o.ordered_qty < o.requested_qty));

// Test 2: plenty of cash, every request should be filled in full
const r2 = createBrain().review({ day: 10, numDays: 60, canOrder: true, cash: 100000, products });
check('with ample cash, nothing is cut back', r2.orders.every((o) => o.ordered_qty === o.requested_qty));

// Test 3: final day, no orders allowed
const r3 = createBrain().review({ day: 60, numDays: 60, canOrder: false, cash: 100000, products });
check('no orders placed on the final day', r3.orders.length === 0);

process.exit(failed ? 1 : 0);