# Autonomous Supermarket: 60-Day Simulation and Commercial Assurance

CSE3CWA / CSE5006, Assessment 4. A full-stack prototype of a small, unstaffed IGA-style supermarket near Swanston Street and Melbourne Town Hall. It simulates 60 trading days, runs a rule-based "Store Brain" that watches stock and reorders, and reports the result to a remote manager with checks that prove the figures reconcile. It is a fictional scenario and is not affiliated with IGA.

**Stack:** React 18 (Vite) frontend, Node.js + Express backend, SQLite (better-sqlite3) for all persistent data. Charts are plain SVG and styling is plain CSS.

## Run it

Requirements: Node.js 20 or newer (built and tested on Node v24.21.0 with npm 11.19.0). No environment variables are needed. Ports 4000 (API) and 5173 (website) must be free.

```
npm install
npm run dev
```

Then open **http://localhost:5173**. The single `npm install` in the project root also installs the server and client packages. `PORT` can be set to change the API port (default 4000).

If `better-sqlite3` cannot download a prebuilt binary for your machine it compiles one, which needs build tools (macOS: `xcode-select --install`; Windows: Visual Studio Build Tools and Python).

## Where to find things in the website

| What | Where |
| --- | --- |
| Submitted Run and its Run ID | Green banner at the top and the Run dropdown (marked "Submitted Run"). The app opens it by default. |
| Model Declaration | Tab 1. Run configuration, the six declared assumptions, customer types, missions, events, Store Brain rules, all 76 products. |
| 60-Day Commercial Report | Tab 2. Part 1 (business performance), Part 2 (inventory and Store Brain operations) and Part 3 (three findings with recommendations, at the bottom). |
| Daily Reports | Tab 3. One reusable view with a day selector for Days 1 to 60, plus every transaction of that day. |
| Commercial Assurance | Tab 4. History completeness, inventory, revenue and cash reconciliation, PASS/FAIL and exceptions. |
| Tracing a figure | Click a bar in a chart, a product name, or a day in a table. Product names open a 60-day trace; days open the Daily Report. |

## Database and the Submitted Run

- The database is one file: `server/data/supermarket.db`. It is included in the ZIP and loaded automatically when the server starts. Please do not delete it, because it holds the Submitted Run. (If it is missing the server creates an empty database and you can make new runs, but they will not be the Submitted Run.)
- **Submitted Run ID: `RUN-20261013073510-292`.** It is recorded in the `submitted_run` table together with its three written findings.
- The database also holds one extra run, `RUN-20261013074754-HP6` (label "Marker test run"), created while I tested the "Create new run" button. It is stored separately and the Submitted Run is unchanged.
- **To create a new run:** click **Create new run** at the top right of the website (about half a second for 60 days), or run `node server/src/createRun.js "my label"`, which also prints the assurance results. Each new run gets a random seed, so its numbers differ from the Submitted Run. New runs have no written findings, so Part 3 says none are stored for them.
- **History is append-only.** A run's configuration is frozen when it starts (`runs`, `run_products`) and every history table (visits, transactions, inventory movements, orders, cash, Store Brain events, lost sales, findings) has SQLite triggers that refuse UPDATE and DELETE. The API has no route that edits or deletes a run. This is an application-level guarantee, not cryptographic.

## Architecture and data flow

```
catalogue.js + model.js + brain.js      configuration and rules (frozen into each run)
          |
      engine.js                         runs the 60-day cycle
          |
   SQLite history (append-only)         transactions, inventory movements, orders, cash, Store Brain events
          |
      reports.js                        every report figure and assurance check is a SQL query on stored history
          |
   Express API (/api/runs/...)          GET only for reports, POST /api/runs to create a run
          |
   React pages                          Model, Report, Daily, Assurance, product trace
```

Files that matter: `server/src/schema.js` (tables and triggers), `catalogue.js` (76 products), `model.js` (customer and demand model), `brain.js` (Store Brain), `engine.js` (simulation), `reports.js` (reports and assurance), `index.js` (API), and `client/src/pages/` (the four tabs and the product trace).

Daily cycle: before opening, yesterday's orders arrive and expired stock is removed. Customers then arrive hour by hour and shop. At close the day's sales are banked, the Store Brain reviews the closing state and places orders (cost deducted from cash immediately, stock arrives before opening the next day). No order is placed after Day 60. Sales take from the earliest-expiring stock lot first, so expired stock can never be sold.

## Customer and demand model (summary)

- Day 1 is a Monday. Expected customers: 520 on weekdays, 330 on Saturdays, 280 on Sundays, with 7% random daily variation. Trading hours are 06:00 to 22:59.
- Four customer types (office worker, resident, student, visitor) with different weekday and weekend shares and their own hourly profiles. Arrivals per type and hour are Poisson draws.
- Five shopping missions (lunch, snack and drink, top-up, stock-up, convenience) set basket size, category preference and the chance of buying more than one unit.
- Products inside a category are chosen by a popularity weight, so demand is uneven. If an item is out of stock, 35% of customers switch to another product in the same category; otherwise the demand is recorded as lost.
- Two declared events: a city festival on Day 20 (Saturday) and a heatwave on Days 31 to 33 (drinks demand up).
- Catalogue: 76 products in 8 categories, 26 perishable (shelf life 1 to 45 days), opening inventory cost A$22,820.30 against the A$40,000 budget, opening operating cash A$15,000.

## Store Brain (summary)

A rule-based review at close each day. It estimates tomorrow's demand from the last 7 days of sales plus lost demand, adjusted for weekday or weekend traffic, then:

- flags **sold out** (stock hit zero that day), **low stock** (sellable stock under one day of expected demand), **expiry warnings** (units in lots close to expiry that are unlikely to sell in time) and **slow movers** (stock above 25 days of recent sales, or above shelf life for perishables);
- orders up to a target of expected demand over a cover period (4 days for normal items, 3 for fast movers, shelf life minus 1 day for perishables, limited to 1 to 3 days) plus safety stock;
- funds orders in priority order (sold out, then low stock, then routine, highest expected gross profit first) and cuts any order to what the remaining cash can pay for, recording a "cash constrained" event when that happens.

## Checks you can run

```
node server/src/checkCatalogue.js      validates the catalogue and the A$40,000 opening budget
node server/src/testCashRule.js        proves the Store Brain never spends more than the cash available
node server/src/runEngineTest.js brain runs 60 days in a throwaway in-memory database and reconciles it
```

`runEngineTest.js` and `testCashRule.js` do not touch the real database. `createRun.js` does (it adds a run).

## AI collaboration

**Tools:** Claude (Anthropic) in a chat window did the planning, drafting and debugging with me. Cursor was my editor and terminal. I ran every command myself and read the output while improving the design and logical changes.

**What AI helped with:** the first draft of the product catalogue and its prices, the model parameters, the database schema, the engine and Store Brain rules, the SQL for the reports and assurance checks, the React pages and CSS, a first draft of the three written findings (from the figures printed by my final run), and the Format of this README to make it look nice once finished.

**What I reviewed, changed or rejected:**

- The report pages first loaded very slowly. The generated queries were missing database indexes. I noticed the delay, and we added ten indexes, after which the report loads almost instantly.
- The first full Store Brain run produced no slow-mover events at all, so that required rule was never exercised. I did not accept that as it was. We added six long-tail products and re-ran, and the Store Brain now flags slow movers on real data.
- A large block of pasted terminal commands failed with a shell error, so I created the files in the editor instead. A file name capital-letter mismatch (`app.jsx` against `App.jsx`) worked on my Mac but would break on Windows or Linux, so I renamed it with `git mv`. A stray "0" appeared on the page from a React condition and I had it fixed.
- The script that stores the written findings checks 15 quoted figures against the stored run and refuses to write if any differ, so the commentary cannot drift from the data.

**What I remain responsible for:** the product range, the customer and demand assumptions, the Store Brain rules, the stored history and every claim in the report. I can explain the simulation logic, the financial calculations, the restocking decisions and the audit checks.

**One limitation:** the demand model is declared by me, not measured from a real store, so the patterns in the report are outputs of my assumptions, not market evidence.

## Known limitations

- Customer types, hourly profiles, missions, prices and costs are assumptions. The blended gross margin (about 46%) is convenience-store style and higher than a large supermarket's.
- Gross profit is not net profit. Rent, hardware, utilities, insurance, shrinkage and overheads are outside the model boundary.
- Suppliers always deliver in full the next day, with no minimum order or delivery charge, even though the Store Brain places about 57 order lines a day.
- Conversion is about 99.97% because every simulated arrival comes with a shopping mission. "Customers" means shoppers who intend to buy.
- No markdowns, price response, theft or loyalty effects. The 35% substitution rate is an assumption.
- There is no login. Anyone who can open the website can create a new run (never edit or delete one).
- The append-only protection is application-level triggers. Someone with direct file access could remove the triggers.
- A run is a pre-operational prototype and needs real operating data before it can be calibrated or validated.