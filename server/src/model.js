// Customer, shopping and demand model for the simulated store.
// Everything the marker needs for the Model Declaration lives here as data.

export const MODEL_VERSION = 'model-v1';
export const NUM_DAYS = 60;
export const FIRST_DAY_WEEKDAY = 1; // Day 1 is a Monday (1 = Mon ... 7 = Sun)

// The store trades 06:00-22:59 (hours 6 to 22). Hourly arrays below match this order.
export const TRADING_HOURS = [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22];

// Expected customers per day before noise (CBD: busy weekdays, quieter weekends).
export const BASE_CUSTOMERS = { weekday: 520, saturday: 330, sunday: 280 };
export const DAILY_NOISE_SD = 0.07; // random day-to-day variation (7%)

// Chance a customer buys a similar product in the same category when the wanted one is sold out.
export const SUBSTITUTE_PROB = 0.35;

export const CUSTOMER_TYPES = {
  OFFICE: {
    description: 'Office worker nearby: lunch and quick snack/drink trips, peaks 8am, 12-1pm and 5pm.',
    shareWeekday: 0.45,
    shareWeekend: 0.08,
    hourly: [2, 6, 9, 5, 4, 8, 14, 12, 6, 5, 7, 10, 6, 3, 2, 1, 0.5],
    missions: { LUNCH: 0.45, SNACK_DRINK: 0.3, TOP_UP: 0.15, CONVENIENCE: 0.1 }
  },
  RESIDENT: {
    description: 'CBD apartment resident: evening top-up and larger household shops, busier on weekends.',
    shareWeekday: 0.25,
    shareWeekend: 0.4,
    hourly: [2, 4, 5, 4, 4, 4, 5, 4, 4, 5, 7, 10, 12, 11, 8, 5, 2],
    missions: { TOP_UP: 0.45, STOCK_UP: 0.2, SNACK_DRINK: 0.15, CONVENIENCE: 0.1, LUNCH: 0.1 }
  },
  STUDENT: {
    description: 'Student: cheap meals, snacks and drinks across the afternoon and evening.',
    shareWeekday: 0.18,
    shareWeekend: 0.17,
    hourly: [0.5, 2, 4, 5, 5, 7, 10, 9, 7, 7, 7, 8, 8, 7, 5, 3, 1.5],
    missions: { SNACK_DRINK: 0.4, LUNCH: 0.3, TOP_UP: 0.2, CONVENIENCE: 0.1 }
  },
  VISITOR: {
    description: 'Visitor or tourist: drinks, snacks and convenience items, midday to afternoon, stronger on weekends.',
    shareWeekday: 0.12,
    shareWeekend: 0.35,
    hourly: [0.5, 1, 2, 4, 6, 9, 12, 12, 11, 10, 9, 8, 6, 5, 3, 2, 1],
    missions: { SNACK_DRINK: 0.45, LUNCH: 0.25, CONVENIENCE: 0.25, TOP_UP: 0.05 }
  }
};

// Mission = why the customer came in. Controls basket size and category preference.
// meanItems: average number of different products in the basket (minimum 1).
// multiBuyProb: chance a line has quantity above 1 (quantity 2 mostly, sometimes 3).
// hourFactor: optional multiplier by trading hour (same order as TRADING_HOURS).
export const MISSIONS = {
  LUNCH: {
    description: 'Lunch run: ready-to-eat food plus a drink.',
    meanItems: 2.4,
    multiBuyProb: 0.05,
    categoryWeights: { 'Ready-to-Eat': 0.45, Drinks: 0.28, 'Snacks & Confectionery': 0.12, 'Fresh & Bakery': 0.05, 'Dairy & Chilled': 0.1 },
    hourFactor: [0.05, 0.05, 0.1, 0.2, 0.5, 1.2, 1.5, 1.2, 0.7, 0.3, 0.1, 0.1, 0.2, 0.3, 0.2, 0.1, 0.1]
  },
  SNACK_DRINK: {
    description: 'Quick snack or drink.',
    meanItems: 1.8,
    multiBuyProb: 0.15,
    categoryWeights: { Drinks: 0.45, 'Snacks & Confectionery': 0.45, 'Dairy & Chilled': 0.07, 'Personal & Convenience': 0.03 }
  },
  TOP_UP: {
    description: 'Everyday top-up shop: milk, bread, fresh items, a few groceries.',
    meanItems: 4.5,
    multiBuyProb: 0.15,
    categoryWeights: {
      'Grocery & Pantry': 0.2, 'Dairy & Chilled': 0.25, 'Fresh & Bakery': 0.22, Drinks: 0.08,
      'Snacks & Confectionery': 0.07, 'Ready-to-Eat': 0.08, Household: 0.05, 'Personal & Convenience': 0.05
    }
  },
  STOCK_UP: {
    description: 'Larger household shop: pantry, household and personal items, mostly after 3pm.',
    meanItems: 8.5,
    multiBuyProb: 0.3,
    categoryWeights: {
      'Grocery & Pantry': 0.28, 'Dairy & Chilled': 0.16, 'Fresh & Bakery': 0.14, Household: 0.16,
      'Personal & Convenience': 0.08, Drinks: 0.1, 'Snacks & Confectionery': 0.08
    },
    hourFactor: [0.1, 0.1, 0.1, 0.2, 0.3, 0.3, 0.3, 0.3, 0.4, 0.8, 1, 1.2, 1.2, 1.2, 1, 0.6, 0.3]
  },
  CONVENIENCE: {
    description: 'Urgent single item: charger, batteries, toiletries, umbrella.',
    meanItems: 1.4,
    multiBuyProb: 0.05,
    categoryWeights: { 'Personal & Convenience': 0.4, Household: 0.15, Drinks: 0.2, 'Snacks & Confectionery': 0.15, 'Grocery & Pantry': 0.1 }
  }
};

// Declared special events that explain unusual days in the results.
export const EVENTS = [
  {
    name: 'City festival (Saturday, Day 20)',
    days: [20],
    customerMultiplier: 1.4,
    typeShareMultiplier: { VISITOR: 2.0 },
    categoryMultiplier: { Drinks: 1.3, 'Ready-to-Eat': 1.3, 'Snacks & Confectionery': 1.2 }
  },
  {
    name: 'Heatwave (Days 31-33)',
    days: [31, 32, 33],
    customerMultiplier: 1.05,
    typeShareMultiplier: {},
    categoryMultiplier: { Drinks: 1.7 }
  }
];

export const MODEL_CONFIG = {
  version: MODEL_VERSION,
  numDays: NUM_DAYS,
  firstDayWeekday: FIRST_DAY_WEEKDAY,
  tradingHours: TRADING_HOURS,
  baseCustomers: BASE_CUSTOMERS,
  dailyNoiseSd: DAILY_NOISE_SD,
  substituteProb: SUBSTITUTE_PROB,
  customerTypes: CUSTOMER_TYPES,
  missions: MISSIONS,
  events: EVENTS
};

// ---------- helpers ----------

export function dayOfWeek(day) {
  return ((FIRST_DAY_WEEKDAY - 1 + day - 1) % 7) + 1; // 1 = Mon ... 7 = Sun
}

export function dayType(day) {
  const d = dayOfWeek(day);
  if (d === 6) return 'saturday';
  if (d === 7) return 'sunday';
  return 'weekday';
}

export const WEEKDAY_NAMES = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// Small seeded random number generator (mulberry32) so runs can be reproduced if wanted.
export function createRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randNormal(rng) {
  const u = Math.max(rng(), 1e-12);
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function randPoisson(rng, mean) {
  if (mean <= 0) return 0;
  const limit = Math.exp(-mean);
  let k = 0;
  let p = 1;
  do {
    k += 1;
    p *= rng();
  } while (p > limit);
  return k - 1;
}

// entries: array of [key, weight]; picks one key in proportion to its weight.
export function weightedPick(rng, entries) {
  let total = 0;
  for (const [, w] of entries) total += w;
  if (total <= 0) return entries.length ? entries[0][0] : null;
  let r = rng() * total;
  for (const [key, w] of entries) {
    r -= w;
    if (r <= 0) return key;
  }
  return entries[entries.length - 1][0];
}