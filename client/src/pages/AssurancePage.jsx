import { useState } from 'react';
import { useApi } from '../api.js';
import { Card, Stat, Badge, Table, Loading, ErrorBox } from '../ui.jsx';
import { money, int, num, dateTime } from '../format.js';

const show = (v) => (typeof v === 'number' ? num(v, Number.isInteger(v) ? 0 : 2) : String(v));

const COUNT_LABELS = [
  ['customer_visits', 'Customer visits'],
  ['transactions', 'Transactions'],
  ['transaction_items', 'Transaction line items'],
  ['inventory_lots', 'Inventory lots (receipts and opening stock)'],
  ['inventory_movements', 'Inventory movements'],
  ['replenishment_orders', 'Replenishment orders'],
  ['cash_ledger', 'Cash ledger entries'],
  ['brain_events', 'Store Brain events'],
  ['lost_sales', 'Lost-sale records'],
  ['run_products', 'Product configuration rows']
];

export default function AssurancePage({ runId, openDay, openProduct }) {
  const { data: a, error, loading } = useApi(`/runs/${runId}/assurance`);
  const [invFilter, setInvFilter] = useState('ALL');

  if (loading) return <Loading />;
  if (error) return <ErrorBox message={error} />;

  const h = a.history;
  const inv = a.inventory.totals;
  const cash = a.cash;
  const pass = a.overall === 'PASS';
  const area = (name) => a.checks.filter((c) => c.area === name);
  const checkCols = [
    { key: 'name', label: 'Check' },
    { key: 'expected', label: 'Expected', align: 'right', render: (r) => show(r.expected) },
    { key: 'actual', label: 'Recorded', align: 'right', render: (r) => show(r.actual) },
    { key: 'status', label: 'Result', render: (r) => <Badge status={r.status} /> }
  ];
  const invRows = a.inventory.products.filter((p) => invFilter === 'ALL' || p.status === 'FAIL');

  return (
    <>
      <Card title="Part 4 - Commercial assurance" subtitle="Can the client trust the report? Every check below is recalculated from the stored run history each time this page opens.">
        <div className="stats">
          <Stat label="Overall result" value={<Badge status={a.overall} />} hint={`${a.checks_passed} of ${a.checks_total} checks passed`} tone={pass ? 'good' : 'bad'} />
          <Stat label="Run ID" value={<span style={{ fontSize: 14 }}>{h.run_id}</span>} hint={h.submitted ? 'Submitted Run' : 'Not the Submitted Run'} />
          <Stat label="Days retained" value={`${h.days_retained}/${h.days_expected}`} tone={h.days_retained === h.days_expected ? 'good' : 'bad'} />
          <Stat label="Integrity exceptions" value={a.exceptions.length} tone={a.exceptions.length ? 'bad' : 'good'} />
        </div>
        <h3>Exceptions</h3>
        {a.exceptions.length === 0 ? (
          <p>No integrity failures or unexplained exceptions were found in this run.</p>
        ) : (
          <Table columns={[{ key: 'area', label: 'Area' }, ...checkCols]} rows={a.exceptions} />
        )}
        <h3>Business outcomes that are not integrity failures</h3>
        <ul>
          {a.notes.map((n) => <li key={n}>{n}</li>)}
        </ul>
      </Card>

      <Card title="1. History completeness" subtitle="Configuration is frozen at the start of a run and history is append-only: the database refuses any edit or delete of these records.">
        <div className="stats">
          <Stat label="Started" value={<span style={{ fontSize: 14 }}>{dateTime(h.created_at)}</span>} />
          <Stat label="Completed" value={<span style={{ fontSize: 14 }}>{dateTime(h.completed_at)}</span>} />
          <Stat label="Protection triggers" value={h.append_only_triggers} hint="block UPDATE and DELETE" />
        </div>
        <div className="grid2" style={{ marginTop: 14 }}>
          <Table
            columns={[{ key: 'label', label: 'Record type retained for audit' }, { key: 'n', label: 'Rows for this run', align: 'right' }]}
            rows={COUNT_LABELS.map(([k, label]) => ({ label, n: int(h.counts[k]) }))}
          />
          <Table columns={checkCols} rows={area('History')} />
        </div>
      </Card>

      <Card title="2. Inventory reconciliation" subtitle="Opening stock + replenishment received - units sold - units expired or written off = closing stock. Each term comes from a different record: the catalogue, the order table, the transactions and the movement ledger.">
        <div className="stats">
          <Stat label="Opening stock" value={int(inv.opening)} />
          <Stat label="+ Received" value={int(inv.received)} />
          <Stat label="- Sold" value={int(inv.sold)} />
          <Stat label="- Expired" value={int(inv.expired)} />
          <Stat label="= Expected closing" value={int(inv.expected_closing)} />
          <Stat label="Recorded closing" value={int(inv.closing)} tone={inv.expected_closing === inv.closing ? 'good' : 'bad'} />
        </div>
        <h3>Checks</h3>
        <Table columns={checkCols} rows={area('Inventory')} />
        <h3>
          Product-by-product reconciliation{' '}
          <select value={invFilter} onChange={(e) => setInvFilter(e.target.value)} style={{ marginLeft: 8 }}>
            <option value="ALL">All products ({a.inventory.products.length})</option>
            <option value="FAIL">Failing only</option>
          </select>
        </h3>
        <Table
          maxHeight={400}
          onRowClick={(p) => openProduct(p.product_id)}
          columns={[
            { key: 'name', label: 'Product' },
            { key: 'opening', label: 'Opening', align: 'right', render: (r) => int(r.opening) },
            { key: 'received', label: 'Received', align: 'right', render: (r) => int(r.received) },
            { key: 'sold', label: 'Sold', align: 'right', render: (r) => int(r.sold) },
            { key: 'expired', label: 'Expired', align: 'right', render: (r) => int(r.expired) },
            { key: 'expected_closing', label: 'Expected', align: 'right', render: (r) => int(r.expected_closing) },
            { key: 'closing', label: 'Recorded', align: 'right', render: (r) => int(r.closing) },
            { key: 'status', label: 'Result', render: (r) => <Badge status={r.status} /> }
          ]}
          rows={invRows}
          empty="No failing products (0)"
        />
      </Card>

      <Card title="3. Revenue reconciliation" subtitle="Daily revenue = the sum of that day's recorded transaction totals, and 60-day revenue = the sum of the daily figures.">
        <div className="stats">
          <Stat label="Sum of transaction totals" value={money(a.revenue.total_transactions)} />
          <Stat label="Sum of 60 daily revenue figures" value={money(a.revenue.total_daily)} tone={Math.abs(a.revenue.total_transactions - a.revenue.total_daily) < 0.005 ? 'good' : 'bad'} />
        </div>
        <h3>Checks</h3>
        <Table columns={checkCols} rows={area('Revenue')} />
        <h3>Every day (click a day to open its Daily Report)</h3>
        <Table
          maxHeight={400}
          onRowClick={(r) => openDay(r.day)}
          columns={[
            { key: 'day', label: 'Day', render: (r) => `Day ${r.day}` },
            { key: 'transaction_total', label: 'Sum of transactions', align: 'right', render: (r) => money(r.transaction_total) },
            { key: 'item_total', label: 'Sum of line items', align: 'right', render: (r) => money(r.item_total) },
            { key: 'daily_revenue', label: 'Daily revenue', align: 'right', render: (r) => money(r.daily_revenue) },
            { key: 'difference', label: 'Difference', align: 'right', render: (r) => money(r.difference) },
            { key: 'status', label: 'Result', render: (r) => <Badge status={r.status} /> }
          ]}
          rows={a.revenue.days}
        />
      </Card>

      <Card title="4. Operating-cash reconciliation" subtitle="Closing cash = opening cash + sales revenue - replenishment spending, and no order may exceed the cash available when it was placed.">
        <div className="stats">
          <Stat label="Opening cash" value={money(cash.opening_cash)} />
          <Stat label="+ Sales revenue" value={money(cash.sales_revenue)} />
          <Stat label="- Replenishment spending" value={money(cash.replenishment_spending)} />
          <Stat label="= Expected closing cash" value={money(cash.expected_closing)} />
          <Stat label="Recorded closing cash" value={money(cash.closing_cash)} tone={Math.abs(cash.expected_closing - cash.closing_cash) < 0.005 ? 'good' : 'bad'} />
          <Stat label="Lowest balance" value={money(cash.lowest_balance)} />
        </div>
        <h3>Checks</h3>
        <Table columns={checkCols} rows={[...area('Cash'), ...area('Budget')]} />
      </Card>
    </>
  );
}