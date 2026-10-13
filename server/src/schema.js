// Database schema for the Autonomous Supermarket.
// Design rules:
//  - Model configuration (runs, run_products) is separate from recorded history.
//  - History tables are append-only: SQLite triggers block UPDATE and DELETE.
//  - A run is "completed" when a row exists in run_completions.
//  - Reports are derived from these tables, never stored as editable numbers.

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS runs (
  run_id           TEXT PRIMARY KEY,
  label            TEXT NOT NULL,
  created_at       TEXT NOT NULL,
  seed             INTEGER NOT NULL,
  opening_cash     REAL NOT NULL,
  inventory_budget REAL NOT NULL,
  num_days         INTEGER NOT NULL,
  config_json      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS run_completions (
  run_id          TEXT PRIMARY KEY REFERENCES runs(run_id),
  completed_at    TEXT NOT NULL,
  days_completed  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS run_products (
  run_id          TEXT NOT NULL REFERENCES runs(run_id),
  product_id      TEXT NOT NULL,
  name            TEXT NOT NULL,
  category        TEXT NOT NULL,
  unit_cost       REAL NOT NULL,
  unit_price      REAL NOT NULL,
  initial_qty     INTEGER NOT NULL,
  perishable      INTEGER NOT NULL,
  shelf_life_days INTEGER,
  popularity      REAL NOT NULL,
  PRIMARY KEY (run_id, product_id)
);

CREATE TABLE IF NOT EXISTS inventory_lots (
  lot_id        INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id        TEXT NOT NULL REFERENCES runs(run_id),
  product_id    TEXT NOT NULL,
  received_day  INTEGER NOT NULL,
  expiry_day    INTEGER,
  qty_received  INTEGER NOT NULL,
  unit_cost     REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS inventory_movements (
  movement_id    INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id         TEXT NOT NULL REFERENCES runs(run_id),
  day            INTEGER NOT NULL,
  product_id     TEXT NOT NULL,
  lot_id         INTEGER REFERENCES inventory_lots(lot_id),
  movement_type  TEXT NOT NULL CHECK (movement_type IN ('OPENING','RECEIPT','SALE','EXPIRY')),
  qty            INTEGER NOT NULL,
  ref_id         INTEGER
);

CREATE TABLE IF NOT EXISTS customer_visits (
  visit_id       INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id         TEXT NOT NULL REFERENCES runs(run_id),
  day            INTEGER NOT NULL,
  hour           INTEGER NOT NULL,
  customer_type  TEXT NOT NULL,
  mission        TEXT NOT NULL,
  items_wanted   INTEGER NOT NULL,
  items_bought   INTEGER NOT NULL,
  outcome        TEXT NOT NULL CHECK (outcome IN ('PURCHASED','WALKED_OUT'))
);

CREATE TABLE IF NOT EXISTS transactions (
  txn_id    INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id    TEXT NOT NULL REFERENCES runs(run_id),
  day       INTEGER NOT NULL,
  hour      INTEGER NOT NULL,
  visit_id  INTEGER REFERENCES customer_visits(visit_id),
  units     INTEGER NOT NULL,
  total     REAL NOT NULL,
  cogs      REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS transaction_items (
  item_id     INTEGER PRIMARY KEY AUTOINCREMENT,
  txn_id      INTEGER NOT NULL REFERENCES transactions(txn_id),
  run_id      TEXT NOT NULL REFERENCES runs(run_id),
  day         INTEGER NOT NULL,
  product_id  TEXT NOT NULL,
  qty         INTEGER NOT NULL,
  unit_price  REAL NOT NULL,
  unit_cost   REAL NOT NULL,
  line_total  REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS replenishment_orders (
  order_id       INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id         TEXT NOT NULL REFERENCES runs(run_id),
  day_placed     INTEGER NOT NULL,
  day_due        INTEGER NOT NULL,
  product_id     TEXT NOT NULL,
  requested_qty  INTEGER NOT NULL,
  ordered_qty    INTEGER NOT NULL,
  unit_cost      REAL NOT NULL,
  line_cost      REAL NOT NULL,
  reason         TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cash_ledger (
  entry_id       INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id         TEXT NOT NULL REFERENCES runs(run_id),
  day            INTEGER NOT NULL,
  entry_type     TEXT NOT NULL CHECK (entry_type IN ('OPENING','SALES','REPLENISHMENT')),
  amount         REAL NOT NULL,
  balance_after  REAL NOT NULL,
  ref_id         INTEGER
);

CREATE TABLE IF NOT EXISTS brain_events (
  event_id      INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id        TEXT NOT NULL REFERENCES runs(run_id),
  day           INTEGER NOT NULL,
  event_type    TEXT NOT NULL,
  product_id    TEXT,
  detail        TEXT NOT NULL,
  action_taken  TEXT NOT NULL,
  ref_order_id  INTEGER
);

CREATE TABLE IF NOT EXISTS lost_sales (
  lost_id     INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id      TEXT NOT NULL REFERENCES runs(run_id),
  day         INTEGER NOT NULL,
  hour        INTEGER NOT NULL,
  visit_id    INTEGER REFERENCES customer_visits(visit_id),
  product_id  TEXT NOT NULL,
  qty         INTEGER NOT NULL,
  reason      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS run_findings (
  finding_id      INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id          TEXT NOT NULL REFERENCES runs(run_id),
  finding_no      INTEGER NOT NULL,
  title           TEXT NOT NULL,
  observation     TEXT NOT NULL,
  evidence        TEXT NOT NULL,
  diagnosis       TEXT NOT NULL,
  implication     TEXT NOT NULL,
  recommendation  TEXT NOT NULL,
  limitation      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS submitted_run (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  run_id     TEXT NOT NULL REFERENCES runs(run_id),
  marked_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_movements_run_day ON inventory_movements(run_id, day);
CREATE INDEX IF NOT EXISTS idx_movements_run_product ON inventory_movements(run_id, product_id);
CREATE INDEX IF NOT EXISTS idx_visits_run_day ON customer_visits(run_id, day);
CREATE INDEX IF NOT EXISTS idx_txn_run_day ON transactions(run_id, day);
CREATE INDEX IF NOT EXISTS idx_items_run_product ON transaction_items(run_id, product_id);
CREATE INDEX IF NOT EXISTS idx_orders_run_day ON replenishment_orders(run_id, day_placed);
CREATE INDEX IF NOT EXISTS idx_cash_run_day ON cash_ledger(run_id, day);
CREATE INDEX IF NOT EXISTS idx_brain_run_day ON brain_events(run_id, day);
CREATE INDEX IF NOT EXISTS idx_txn_visit ON transactions(visit_id);
CREATE INDEX IF NOT EXISTS idx_items_txn ON transaction_items(txn_id);
CREATE INDEX IF NOT EXISTS idx_items_run_day ON transaction_items(run_id, day);
CREATE INDEX IF NOT EXISTS idx_movements_lot ON inventory_movements(lot_id);
CREATE INDEX IF NOT EXISTS idx_lots_run_product ON inventory_lots(run_id, product_id);
CREATE INDEX IF NOT EXISTS idx_lost_run_day ON lost_sales(run_id, day);
CREATE INDEX IF NOT EXISTS idx_lost_run_product ON lost_sales(run_id, product_id);
CREATE INDEX IF NOT EXISTS idx_orders_run_product ON replenishment_orders(run_id, product_id);
CREATE INDEX IF NOT EXISTS idx_orders_run_due ON replenishment_orders(run_id, day_due);
CREATE INDEX IF NOT EXISTS idx_brain_run_type ON brain_events(run_id, event_type, product_id);
`;

export const APPEND_ONLY_TABLES = [
  'runs',
  'run_completions',
  'run_products',
  'inventory_lots',
  'inventory_movements',
  'customer_visits',
  'transactions',
  'transaction_items',
  'replenishment_orders',
  'cash_ledger',
  'brain_events',
  'lost_sales',
  'run_findings'
];

export function initSchema(db) {
  db.exec(SCHEMA_SQL);
  for (const table of APPEND_ONLY_TABLES) {
    db.exec(
      `CREATE TRIGGER IF NOT EXISTS ${table}_no_update BEFORE UPDATE ON ${table} ` +
        `BEGIN SELECT RAISE(ABORT, '${table} is append-only: updates are not allowed'); END;`
    );
    db.exec(
      `CREATE TRIGGER IF NOT EXISTS ${table}_no_delete BEFORE DELETE ON ${table} ` +
        `BEGIN SELECT RAISE(ABORT, '${table} is append-only: deletes are not allowed'); END;`
    );
  }
}