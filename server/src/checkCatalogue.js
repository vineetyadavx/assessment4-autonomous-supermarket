import { PRODUCTS, CATEGORIES, INVENTORY_BUDGET } from './catalogue.js';

const problems = [];
const ids = new Set();

for (const p of PRODUCTS) {
  if (ids.has(p.product_id)) problems.push(`Duplicate id ${p.product_id}`);
  ids.add(p.product_id);
  if (!CATEGORIES.includes(p.category)) problems.push(`${p.product_id}: unknown category`);
  if (!(p.unit_price > p.unit_cost)) problems.push(`${p.product_id}: price must exceed cost`);
  if (!Number.isInteger(p.initial_qty) || p.initial_qty <= 0) problems.push(`${p.product_id}: bad quantity`);
  if (p.perishable && !(p.shelf_life_days > 0)) problems.push(`${p.product_id}: perishable needs shelf life`);
  if (!p.perishable && p.shelf_life_days !== null) problems.push(`${p.product_id}: non-perishable has shelf life`);
}

const round2 = (n) => Math.round(n * 100) / 100;
const totalCost = round2(PRODUCTS.reduce((s, p) => s + p.unit_cost * p.initial_qty, 0));
const totalPop = round2(PRODUCTS.reduce((s, p) => s + p.popularity, 0));

console.log(`Products: ${PRODUCTS.length}`);
console.log(`Perishable products: ${PRODUCTS.filter((p) => p.perishable).length}`);
console.log(`Total popularity weight: ${totalPop}`);
console.log('');
console.log('Category                   items   opening cost   avg margin');
for (const c of CATEGORIES) {
  const items = PRODUCTS.filter((p) => p.category === c);
  const cost = round2(items.reduce((s, p) => s + p.unit_cost * p.initial_qty, 0));
  const margin = items.reduce((s, p) => s + (p.unit_price - p.unit_cost) / p.unit_price, 0) / items.length;
  console.log(`${c.padEnd(26)} ${String(items.length).padStart(5)}   ${('$' + cost.toFixed(2)).padStart(12)}   ${(margin * 100).toFixed(1)}%`);
}
console.log('');
console.log(`Opening inventory cost: A$${totalCost.toFixed(2)} (budget A$${INVENTORY_BUDGET})`);
if (totalCost > INVENTORY_BUDGET) problems.push('Opening inventory exceeds the A$40,000 budget');

if (problems.length) {
  console.log('\nPROBLEMS:');
  problems.forEach((x) => console.log(' - ' + x));
  process.exit(1);
} else {
  console.log('\nCatalogue check PASSED');
}