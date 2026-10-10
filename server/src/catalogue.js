// Product catalogue for the simulated IGA-style store (Swanston St, Melbourne CBD).
// Opening inventory is funded by the A$40,000 inventory budget, not by operating cash.
// popularity = relative demand weight used by the shopping model (higher = sells more).
// shelfLifeDays = null means non-perishable.

export const INVENTORY_BUDGET = 40000;
export const OPENING_CASH = 15000;

export const CATEGORIES = [
  'Grocery & Pantry',
  'Drinks',
  'Snacks & Confectionery',
  'Dairy & Chilled',
  'Fresh & Bakery',
  'Ready-to-Eat',
  'Household',
  'Personal & Convenience'
];

const p = (id, name, category, cost, price, qty, shelfLifeDays, popularity) => ({
  product_id: id,
  name,
  category,
  unit_cost: cost,
  unit_price: price,
  initial_qty: qty,
  perishable: shelfLifeDays !== null,
  shelf_life_days: shelfLifeDays,
  popularity
});

const G = 'Grocery & Pantry';
const D = 'Drinks';
const S = 'Snacks & Confectionery';
const C = 'Dairy & Chilled';
const F = 'Fresh & Bakery';
const R = 'Ready-to-Eat';
const H = 'Household';
const P = 'Personal & Convenience';

export const PRODUCTS = [
  // Grocery & Pantry
  p('G01', 'Penne Pasta 500g', G, 1.10, 1.90, 260, null, 1.2),
  p('G02', 'Basmati Rice 1kg', G, 2.40, 3.80, 220, null, 1.0),
  p('G03', 'Canned Tomatoes 400g', G, 0.75, 1.30, 320, null, 1.4),
  p('G04', 'Baked Beans 420g', G, 0.90, 1.50, 200, null, 0.9),
  p('G05', 'Tuna in Springwater 95g', G, 1.00, 1.80, 300, null, 1.3),
  p('G06', 'Instant Noodle Cup 65g', G, 1.10, 2.20, 440, null, 2.0),
  p('G07', 'Plain Flour 1kg', G, 1.30, 2.10, 100, null, 0.4),
  p('G08', 'Raw Sugar 1kg', G, 1.50, 2.40, 100, null, 0.4),
  p('G09', 'Olive Oil 500ml', G, 6.50, 9.50, 110, null, 0.5),
  p('G10', 'Peanut Butter 375g', G, 2.40, 3.80, 130, null, 0.6),
  p('G11', 'Corn Flakes 500g', G, 3.20, 4.80, 170, null, 0.8),
  p('G12', 'Rolled Oats 750g', G, 2.20, 3.50, 110, null, 0.5),

  // Drinks
  p('D01', 'Cola 600ml', D, 1.60, 3.50, 640, null, 3.0),
  p('D02', 'Still Water 600ml', D, 0.55, 2.20, 760, null, 3.5),
  p('D03', 'Sparkling Mineral Water 1L', D, 1.20, 2.80, 260, null, 1.2),
  p('D04', 'Energy Drink 500ml', D, 1.80, 3.90, 400, null, 1.8),
  p('D05', 'Instant Coffee 100g', D, 4.50, 7.00, 100, null, 0.5),
  p('D06', 'Tea Bags 100pk', D, 2.50, 4.00, 100, null, 0.5),
  p('D07', 'Lemonade 1.25L', D, 1.20, 2.50, 220, null, 1.0),
  p('D08', 'Sports Drink 600ml', D, 1.70, 3.50, 260, null, 1.2),

  // Snacks & Confectionery
  p('S01', 'Potato Chips 170g', S, 2.00, 3.80, 500, null, 2.5),
  p('S02', 'Chocolate Block 180g', S, 2.60, 4.20, 400, null, 2.0),
  p('S03', 'Muesli Bars 6pk', S, 2.20, 3.80, 220, null, 1.0),
  p('S04', 'Chewy Lollies 200g', S, 1.60, 3.00, 260, null, 1.2),
  p('S05', 'Salted Peanuts 200g', S, 1.80, 3.20, 180, null, 0.8),
  p('S06', 'Plain Biscuits 250g', S, 1.30, 2.20, 280, null, 1.3),
  p('S07', 'Breath Mints 14g', S, 0.70, 1.60, 320, null, 1.5),
  p('S08', 'Corn Chips 230g', S, 2.10, 3.80, 260, null, 1.2),
  p('S09', 'Chocolate Bar 50g', S, 0.90, 2.00, 640, null, 3.0),

  // Dairy & Chilled
  p('C01', 'Full Cream Milk 1L', C, 1.10, 1.80, 220, 7, 4.0),
  p('C02', 'Lite Milk 1L', C, 1.10, 1.80, 90, 7, 1.5),
  p('C03', 'Greek Yoghurt 170g', C, 1.20, 2.20, 160, 14, 2.0),
  p('C04', 'Tasty Cheese 500g', C, 5.20, 7.50, 80, 30, 0.8),
  p('C05', 'Butter 250g', C, 3.20, 4.50, 70, 45, 0.6),
  p('C06', 'Free Range Eggs 12pk', C, 4.00, 5.80, 120, 21, 1.5),
  p('C07', 'Orange Juice 1L', C, 2.20, 3.90, 90, 10, 1.2),
  p('C08', 'Iced Coffee 500ml', C, 1.90, 3.80, 160, 14, 2.0),
  p('C09', 'Sliced Ham 200g', C, 2.80, 4.80, 60, 12, 0.8),
  p('C10', 'Hommus 200g', C, 1.80, 3.20, 50, 14, 0.6),

  // Fresh & Bakery
  p('F01', 'Bananas 1kg', F, 2.20, 3.50, 120, 5, 2.0),
  p('F02', 'Royal Gala Apples 1kg', F, 2.80, 4.50, 80, 14, 1.0),
  p('F03', 'Truss Tomatoes 500g', F, 2.00, 3.50, 50, 6, 0.8),
  p('F04', 'Baby Spinach 120g', F, 1.60, 2.80, 50, 5, 0.8),
  p('F05', 'Avocado each', F, 1.30, 2.50, 60, 5, 1.0),
  p('F06', 'Sandwich Loaf 650g', F, 1.60, 3.00, 110, 4, 1.8),
  p('F07', 'Sourdough Loaf 600g', F, 3.00, 5.50, 44, 3, 0.8),
  p('F08', 'Butter Croissant', F, 1.20, 3.00, 50, 2, 1.2),
  p('F09', 'Carrots 1kg', F, 1.40, 2.30, 40, 14, 0.5),

  // Ready-to-Eat
  p('R01', 'Chicken Sandwich', R, 3.20, 6.50, 90, 2, 2.5),
  p('R02', 'Ham & Cheese Toastie', R, 2.80, 5.80, 56, 2, 1.5),
  p('R03', 'Sushi Pack 8pc', R, 3.80, 7.50, 70, 1, 2.0),
  p('R04', 'Garden Salad Bowl', R, 3.00, 6.50, 44, 2, 1.2),
  p('R05', 'Beef Pie', R, 2.40, 4.80, 50, 3, 1.3),
  p('R06', 'Fruit Cup 200g', R, 1.50, 3.50, 30, 2, 0.8),
  p('R07', 'Microwave Pasta Meal 350g', R, 3.20, 5.80, 80, 8, 1.0),

  // Household
  p('H01', 'Dish Liquid 500ml', H, 2.00, 3.50, 110, null, 0.5),
  p('H02', 'Paper Towel 2pk', H, 2.80, 4.80, 130, null, 0.6),
  p('H03', 'Toilet Paper 12pk', H, 6.50, 9.50, 120, null, 0.6),
  p('H04', 'Laundry Liquid 1L', H, 6.00, 9.00, 70, null, 0.3),
  p('H05', 'Garbage Bags 20pk', H, 2.20, 3.80, 90, null, 0.4),
  p('H06', 'Sponges 3pk', H, 1.40, 2.60, 70, null, 0.3),
  p('H07', 'Surface Spray 500ml', H, 2.60, 4.40, 70, null, 0.3),

  // Personal & Convenience
  p('P01', 'Toothpaste 110g', P, 2.20, 3.80, 130, null, 0.6),
  p('P02', 'Deodorant 150ml', P, 3.00, 5.50, 110, null, 0.5),
  p('P03', 'Shampoo 400ml', P, 3.50, 6.00, 90, null, 0.4),
  p('P04', 'Hand Sanitiser 250ml', P, 2.00, 3.80, 110, null, 0.5),
  p('P05', 'Tissues 110pk', P, 1.20, 2.50, 180, null, 0.8),
  p('P06', 'USB-C Charging Cable', P, 4.00, 10.00, 70, null, 0.3),
  p('P07', 'AA Batteries 4pk', P, 3.00, 6.50, 70, null, 0.3),
  p('P08', 'Compact Umbrella', P, 6.00, 14.00, 50, null, 0.2)
];