import { useEffect, useState } from 'react';
import { api, useApi } from '../api.js';
import { Card, Stat, Badge, Table, ColumnChart, Loading, ErrorBox } from '../ui.jsx';
import { money, money0, int, num, hourLabel } from '../format.js';

const PAGE = 50;

function TransactionModal({ runId, txnId, onClose, openProduct }) {
  const { data, error, loading } = useApi(`/runs/${runId}/transactions/${txnId}`);
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="card-head">
          <h2>Transaction #{txnId}</h2>
          <button className="secondary" onClick={onClose}>Close</button>
        </div>
        {loading && <p className="muted">Loading...</p>}
        {error && <p>{error}</p>}
        {data && (
          <>
            <p className="muted">
              Day {data.day} at {hourLabel(data.hour)} - {String(data.customer_type).replace(/_/g, ' ')} customer, {String(data.mission).replace(/_/g, ' ')} mission
            </p>
            <Table
              columns={[
                { key: 'name', label: 'Product', render: (r) => (
                  <button className="link" onClick={() => { onClose(); openProduct(r.product_id); }}>{r.name}</button>
                ) },
                { key: 'qty', label: 'Qty', align: 'right' },
                { key: 'unit_price', label: 'Unit price', align: 'right', render: (r) => money(r.unit_price) },
                { key: 'unit_cost', label: 'Unit cost', align: 'right', render: (r) => money(r.unit_cost) },
                { key: 'line_total', label: 'Line total', align: 'right', render: (r) => money(r.line_total) }
              ]}
              rows={data.items}
            />
            <p style={{ textAlign: 'right' }}>
              <b>Transaction total {money(data.total)}</b> <span className="muted">(cost of goods {money(data.cogs)})</span>
            </p>
          </>
        )}
      </div>
    </div>
  );
}

export default function DailyPage({ runId, runInfo, day, setDay, openProduct }) {
  const numDays = runInfo?.num_days || 60;
  const { data: d, error, loading } = useApi(`/runs/${runId}/days/${day}`);
  const [txns, setTxns] = useState({ rows: [], total: 0 });
  const [txnBusy, setTxnBusy] = useState(false);
  const [openTxn, setOpenTxn] = useState(null);
  const [evFilter, setEvFilter] = useState('ALL');

  useEffect(() => {
    let cancelled = false;
    setTxns({ rows: [], total: 0 });
    api(`/runs/${runId}/days/${day}/transactions?offset=0&limit=${PAGE}`)
      .then((r) => !cancelled && setTxns({ rows: r.rows, total: r.total }))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [runId, day]);

  async function loadMore() {
    setTxnBusy(true);
    try {
      const r = await api(`/runs/${runId}/days/${day}/transactions?offset=${txns.rows.length}&limit=${PAGE}`);
      setTxns((t) => ({ rows: [...t.rows, ...r.rows], total: r.total }));
    } finally {
      setTxnBusy(false);
    }
  }

  const goDay = (n) => setDay(Math.min(numDays, Math.max(1, n)));

  const selector = (
    <Card>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
        <button className="secondary" onClick={() => goDay(day - 1)} disabled={day <= 1}>Previous day</button>
        <select value={day} onChange={(e) => goDay(Number(e.target.value))}>
          {Array.from({ length: numDays }, (_, i) => i + 1).map((n) => (
            <option key={n} value={n}>Day {n}</option>
          ))}
        </select>
        <button className="secondary" onClick={() => goDay(day + 1)} disabled={day >= numDays}>Next day</button>
        {d && (
          <span>
            <b>Day {d.day} of {d.num_days}</b> - {d.weekday} {d.is_weekend ? '(weekend)' : '(weekday)'}
          </span>
        )}
        {d && d.special_events.map((e) => <span key={e} className="tag">{e}</span>)}
      </div>
    </Card>
  );

  if (loading) return <>{selector}<Loading /></>;
  if (error) return <>{selector}<ErrorBox message={error} /></>;

  const t = d.trading;
  const c = d.cash;
  const inv = d.inventory;
  const pl = (id, name) =>
    id ? <button className="link" onClick={() => openProduct(id)}>{name || id}</button> : '-';
  const hourData = d.hourly.map((h) => ({ ...h, label: String(h.hour) }));

  const cashOk = Math.abs(c.opening + c.sales - c.replenishment_spend - c.closing) < 0.005;
  const salesOk = Math.abs(c.sales - t.revenue) < 0.005;
  const unitsOk = inv.sold_units === t.units;
  const stockEq = inv.start_units + inv.opening_stock + inv.received_units - inv.sold_units - inv.expired_units;
  const stockOk = stockEq === inv.closing_units;

  const checks = [
    { check: 'Cash banked = sum of transaction totals', figures: `${money(c.sales)} vs ${money(t.revenue)}`, status: salesOk ? 'PASS' : 'FAIL' },
    { check: 'Units sold: transactions = inventory movements', figures: `${int(t.units)} vs ${int(inv.sold_units)}`, status: unitsOk ? 'PASS' : 'FAIL' },
    { check: 'Cash: opening + sales - replenishment = closing', figures: `${money(c.opening)} + ${money(c.sales)} - ${money(c.replenishment_spend)} = ${money(c.closing)}`, status: cashOk ? 'PASS' : 'FAIL' },
    { check: 'Stock: start + opening + received - sold - expired = closing', figures: `${int(inv.start_units)} + ${int(inv.opening_stock)} + ${int(inv.received_units)} - ${int(inv.sold_units)} - ${int(inv.expired_units)} = ${int(inv.closing_units)}`, status: stockOk ? 'PASS' : 'FAIL' }
  ];

  const evTypes = [...new Set(d.events.map((e) => e.event_type))];
  const shownEvents = evFilter === 'ALL' ? d.events : d.events.filter((e) => e.event_type === evFilter);
  const orderCols = [
    { key: 'name', label: 'Product', render: (r) => pl(r.product_id, r.name) },
    { key: 'requested_qty', label: 'Wanted', align: 'right', render: (r) => int(r.requested_qty) },
    { key: 'ordered_qty', label: 'Ordered', align: 'right', render: (r) => int(r.ordered_qty) },
    { key: 'unit_cost', label: 'Unit cost', align: 'right', render: (r) => money(r.unit_cost) },
    { key: 'line_cost', label: 'Cost', align: 'right', render: (r) => money(r.line_cost) },
    { key: 'reason', label: 'Why' }
  ];

  return (
    <>
      {selector}

      <Card title="Trading summary">
        <div className="stats">
          <Stat label="Customers" value={int(t.customers)} />
          <Stat label="Bought something" value={int(t.purchasers)} hint={`${int(t.walked_out)} left empty-handed`} />
          <Stat label="Transactions" value={int(t.transactions)} />
          <Stat label="Units sold" value={int(t.units)} />
          <Stat label="Revenue" value={money(t.revenue)} />
          <Stat label="Gross profit" value={money(t.gross_profit)} hint={`COGS ${money(t.cogs)}`} />
          <Stat label="Avg basket" value={`${num(t.avg_basket_units)} units`} />
          <Stat label="Avg transaction" value={money(t.avg_transaction_value)} />
        </div>
        <div className="grid2" style={{ marginTop: 14 }}>
          <div>
            <h3>Customers by hour</h3>
            <ColumnChart data={hourData} xKey="label" yKey="customers" color="#1d4ed8" format={(v) => num(v, 0)} />
          </div>
          <div>
            <h3>Revenue by hour (A$)</h3>
            <ColumnChart data={hourData} xKey="label" yKey="revenue" color="#0f766e" format={(v) => num(v, 0)} />
          </div>
        </div>
        <h3>By customer type</h3>
        <Table
          columns={[
            { key: 'name', label: 'Type' },
            { key: 'customers', label: 'Customers', align: 'right' },
            { key: 'purchasers', label: 'Bought', align: 'right' },
            { key: 'revenue', label: 'Revenue', align: 'right', render: (r) => money(r.revenue) }
          ]}
          rows={d.byCustomerType}
        />
      </Card>

      <div className="grid2">
        <Card title="Cash" subtitle="Sales are banked at close, then replenishment is paid from the same balance.">
          <div className="stats">
            <Stat label="Opening cash" value={money(c.opening)} />
            <Stat label="Sales banked" value={money(c.sales)} />
            <Stat label="Replenishment spend" value={money(c.replenishment_spend)} />
            <Stat label="Closing cash" value={money(c.closing)} />
          </div>
        </Card>
        <Card title="Inventory" subtitle="Units across all products.">
          <div className="stats">
            <Stat label="Start of day" value={int(inv.start_units)} hint={day === 1 ? 'before opening stock' : ''} />
            <Stat label="Opening stock" value={int(inv.opening_stock)} hint="Day 1 only" />
            <Stat label="Received" value={int(inv.received_units)} hint="yesterday's orders" />
            <Stat label="Sold" value={int(inv.sold_units)} />
            <Stat label="Expired" value={int(inv.expired_units)} tone={inv.expired_units > 0 ? 'bad' : ''} />
            <Stat label="Closing stock" value={int(inv.closing_units)} hint={`${money0(inv.closing_value)} at cost`} />
          </div>
        </Card>
      </div>

      <Card title="Reconciliation for this day" subtitle="Calculated from the stored records for this day only.">
        <Table
          columns={[
            { key: 'check', label: 'Check' },
            { key: 'figures', label: 'Figures' },
            { key: 'status', label: 'Result', render: (r) => <Badge status={r.status} /> }
          ]}
          rows={checks}
        />
      </Card>

      <Card
        title="Store Brain alerts and actions"
        subtitle="Condition detected, then the action taken. Click a product to trace it across all 60 days."
        right={
          <select value={evFilter} onChange={(e) => setEvFilter(e.target.value)}>
            <option value="ALL">All events ({d.events.length})</option>
            {evTypes.map((x) => (
              <option key={x} value={x}>{x.replace(/_/g, ' ')} ({d.events.filter((e) => e.event_type === x).length})</option>
            ))}
          </select>
        }
      >
        <Table
          maxHeight={380}
          columns={[
            { key: 'event_type', label: 'Event', render: (r) => r.event_type.replace(/_/g, ' ') },
            { key: 'product_name', label: 'Product', render: (r) => pl(r.product_id, r.product_name) },
            { key: 'detail', label: 'Condition detected' },
            { key: 'action_taken', label: 'Action taken' }
          ]}
          rows={shownEvents}
          empty="No Store Brain events on this day (0)"
        />
      </Card>

      <div className="grid2">
        <Card title={`Orders placed at close (${d.ordersPlaced.length})`} subtitle={day >= numDays ? 'No orders on the final day: there is no Day 61 in the simulation.' : `Arrive on Day ${day + 1} before opening.`}>
          <Table maxHeight={320} columns={orderCols} rows={d.ordersPlaced} empty="No orders placed (0)" />
        </Card>
        <Card title={`Deliveries received this morning (${d.ordersArrived.length})`} subtitle="Ordered at the end of the previous day.">
          <Table maxHeight={320} columns={orderCols.slice(0, 5)} rows={d.ordersArrived} empty="No deliveries (0)" />
        </Card>
      </div>

      <div className="grid2">
        <Card title="Expired stock removed before opening">
          <Table
            columns={[
              { key: 'name', label: 'Product', render: (r) => pl(r.product_id, r.name) },
              { key: 'units', label: 'Units', align: 'right' },
              { key: 'value', label: 'Value at cost', align: 'right', render: (r) => money(r.value) }
            ]}
            rows={d.expiredProducts}
            empty="Nothing expired (0)"
          />
        </Card>
        <Card title="Demand missed" subtitle="Customers wanted these but stock ran out (a switch to another product is also recorded).">
          <Table
            maxHeight={260}
            columns={[
              { key: 'name', label: 'Product', render: (r) => pl(r.product_id, r.name) },
              { key: 'reason', label: 'What happened', render: (r) => String(r.reason).replace(/_/g, ' ') },
              { key: 'units', label: 'Units', align: 'right' }
            ]}
            rows={d.lostSales}
            empty="No missed demand (0)"
          />
        </Card>
      </div>

      <Card title="Products sold today" subtitle="Click a product for its full 60-day history.">
        <Table
          maxHeight={360}
          columns={[
            { key: 'name', label: 'Product', render: (r) => pl(r.product_id, r.name) },
            { key: 'category', label: 'Category' },
            { key: 'units', label: 'Units', align: 'right', render: (r) => int(r.units) },
            { key: 'revenue', label: 'Revenue', align: 'right', render: (r) => money(r.revenue) }
          ]}
          rows={d.productsSold}
        />
      </Card>

      <Card title={`Transactions (${int(txns.total)})`} subtitle="Click a transaction to see its line items.">
        <Table
          maxHeight={360}
          onRowClick={(r) => setOpenTxn(r.txn_id)}
          columns={[
            { key: 'txn_id', label: 'Transaction', render: (r) => `#${r.txn_id}` },
            { key: 'hour', label: 'Time', render: (r) => hourLabel(r.hour) },
            { key: 'customer_type', label: 'Customer type' },
            { key: 'mission', label: 'Mission', render: (r) => String(r.mission).replace(/_/g, ' ') },
            { key: 'units', label: 'Units', align: 'right' },
            { key: 'total', label: 'Total', align: 'right', render: (r) => money(r.total) }
          ]}
          rows={txns.rows}
          empty="No transactions (0)"
        />
        {txns.rows.length < txns.total && (
          <p>
            <button className="secondary" onClick={loadMore} disabled={txnBusy}>
              {txnBusy ? 'Loading...' : `Show more (${txns.rows.length} of ${int(txns.total)})`}
            </button>
          </p>
        )}
      </Card>

      {openTxn && <TransactionModal runId={runId} txnId={openTxn} onClose={() => setOpenTxn(null)} openProduct={openProduct} />}
    </>
  );
}