import { useApi } from '../api.js';
import { Card, Stat, Table, ColumnChart, Loading, ErrorBox } from '../ui.jsx';
import { money, money0, int, num, pct, compact } from '../format.js';

const EVENT_INFO = {
  LOW_STOCK: 'Sellable stock fell below one day of expected demand',
  SOLD_OUT: 'Stock reached zero during the day',
  EXPIRY_WARNING: 'Units in a lot close to expiry are unlikely to sell in time',
  EXPIRY_WRITEOFF: 'Expired stock removed from sale before opening',
  SLOW_MOVER: 'Stock on hand far above the recent sales rate',
  REPLENISH: 'Order placed at close, delivered the next morning',
  CASH_CONSTRAINED: 'Order cut back because operating cash was insufficient'
};

export default function ReportPage({ runId, openDay, openProduct, goTab }) {
  const s = useApi(`/runs/${runId}/summary`);
  const f = useApi(`/runs/${runId}/findings`);

  if (s.loading) return <Loading />;
  if (s.error) return <ErrorBox message={s.error} />;

  const { part1: p1, part2: p2 } = s.data;
  const st = p1.store;
  const sh = p1.shopper;
  const inv = p2.inventory;
  const brain = p2.brain;

  const productLink = (r) => (
    <button className="link" onClick={() => openProduct && openProduct(r.product_id)}>{r.name}</button>
  );
  const dayLink = (r) => (
    <button className="link" onClick={() => openDay(r.day)}>Day {r.day}</button>
  );

  const weekRows = [
    { label: 'Weekdays (Mon-Fri)', ...sh.weekday_vs_weekend.weekday },
    { label: 'Weekends (Sat-Sun)', ...sh.weekday_vs_weekend.weekend }
  ];
  const segRows = (rows) =>
    rows.map((r) => ({
      ...r,
      name: r.name.replace(/_/g, ' '),
      share: st.revenue ? (r.revenue / st.revenue) * 100 : 0,
      per_customer: r.customers ? r.revenue / r.customers : 0
    }));
  const segCols = (label) => [
    { key: 'name', label },
    { key: 'customers', label: 'Customers', align: 'right', render: (r) => int(r.customers) },
    { key: 'purchasers', label: 'Bought', align: 'right', render: (r) => int(r.purchasers) },
    { key: 'units', label: 'Units', align: 'right', render: (r) => int(r.units) },
    { key: 'revenue', label: 'Revenue', align: 'right', render: (r) => money0(r.revenue) },
    { key: 'share', label: 'Share', align: 'right', render: (r) => pct(r.share) },
    { key: 'per_customer', label: 'Revenue / customer', align: 'right', render: (r) => money(r.per_customer) }
  ];
  const productCols = [
    { key: 'name', label: 'Product', render: productLink },
    { key: 'category', label: 'Category' },
    { key: 'units_sold', label: 'Units sold', align: 'right', render: (r) => int(r.units_sold) },
    { key: 'avg_units_per_day', label: 'Per day', align: 'right', render: (r) => num(r.avg_units_per_day) },
    { key: 'revenue', label: 'Revenue', align: 'right', render: (r) => money0(r.revenue) },
    { key: 'gross_profit', label: 'Gross profit', align: 'right', render: (r) => money0(r.gross_profit) }
  ];
  const countRows = brain.counts.map((c) => ({ ...c, meaning: EVENT_INFO[c.event_type] }));
  const hourData = p1.hourly.map((h) => ({ ...h, label: String(h.hour) }));

  return (
    <>
      <Card title="Part 1 - Business performance" subtitle="What happened to the business over the 60 days?">
        <h3>Store performance</h3>
        <div className="stats">
          <Stat label="Total customers" value={int(st.customers)} hint={`${int(st.purchasing_customers)} bought something`} />
          <Stat label="Transactions" value={int(st.transactions)} />
          <Stat label="Units sold" value={int(st.units_sold)} />
          <Stat label="Sales revenue" value={money0(st.revenue)} />
          <Stat label="COGS" value={money0(st.cogs)} />
          <Stat label="Gross profit" value={money0(st.gross_profit)} hint={`${pct(st.gross_margin_pct)} margin`} tone="good" />
          <Stat label="Expiry / write-off" value={money(st.writeoff_value)} hint={`${int(st.writeoff_units)} units at cost`} tone={st.writeoff_value > 0 ? 'bad' : ''} />
          <Stat label="Closing operating cash" value={money0(st.closing_cash)} hint={`opened at ${money0(st.opening_cash)}`} />
          <Stat label="Closing inventory value" value={money0(st.closing_inventory_value)} hint={`${int(st.closing_inventory_units)} units at cost`} />
        </div>
        <p className="muted">
          Gross profit is sales revenue minus the purchase cost of goods sold. Rent, staff, utilities and overheads are outside the
          model boundary, so this is not net profit.{' '}
          <button className="link" onClick={() => goTab('assurance')}>Check these totals in Commercial Assurance</button>
        </p>
      </Card>

      <Card title="Shopper and basket performance" subtitle="Click a bar to open that day's Daily Report.">
        <div className="stats">
          <Stat label="Avg customers per day" value={num(sh.avg_customers_per_day, 0)} />
          <Stat label="Customers who bought" value={pct(sh.conversion_pct)} hint="the rest left empty-handed" />
          <Stat label="Avg basket size" value={`${num(sh.avg_basket_units)} units`} hint={`${num(sh.avg_basket_lines)} different products`} />
          <Stat label="Avg transaction value" value={money(sh.avg_transaction_value)} />
          <Stat label="Best day" value={`Day ${sh.best_day.day} (${sh.best_day.weekday})`} hint={money0(sh.best_day.revenue)} />
          <Stat label="Weakest day" value={`Day ${sh.worst_day.day} (${sh.worst_day.weekday})`} hint={money0(sh.worst_day.revenue)} />
        </div>
        <div className="grid2" style={{ marginTop: 14 }}>
          <div>
            <h3>Customers per day</h3>
            <ColumnChart data={p1.daily} xKey="day" yKey="customers" color="#1d4ed8" format={(v) => compact(v)} onSelect={(d) => openDay(d.day)} />
          </div>
          <div>
            <h3>Revenue per day (A$)</h3>
            <ColumnChart data={p1.daily} xKey="day" yKey="revenue" color="#0f766e" format={(v) => compact(v)} onSelect={(d) => openDay(d.day)} />
          </div>
        </div>
        <p className="muted">
          Declared events: {sh.event_days.map((e) => `${e.name}`).join('; ') || 'none'}. Weekday and weekend patterns follow the declared customer model.
        </p>
        <h3>Weekday and weekend comparison</h3>
        <Table
          columns={[
            { key: 'label', label: '' },
            { key: 'days', label: 'Days', align: 'right' },
            { key: 'avg_customers', label: 'Avg customers', align: 'right', render: (r) => num(r.avg_customers, 0) },
            { key: 'avg_transactions', label: 'Avg transactions', align: 'right', render: (r) => num(r.avg_transactions, 0) },
            { key: 'avg_units', label: 'Avg units', align: 'right', render: (r) => num(r.avg_units, 0) },
            { key: 'avg_revenue', label: 'Avg revenue', align: 'right', render: (r) => money0(r.avg_revenue) }
          ]}
          rows={weekRows}
        />
        <div className="grid2" style={{ marginTop: 14 }}>
          <div>
            <h3>Average customers by hour of day</h3>
            <ColumnChart data={hourData} xKey="label" yKey="avg_customers_per_day" color="#7c3aed" format={(v) => num(v, 0)} />
          </div>
          <div>
            <h3>By customer type</h3>
            <Table columns={segCols('Type')} rows={segRows(p1.byCustomerType)} />
          </div>
        </div>
        <h3>By shopping mission</h3>
        <Table columns={segCols('Mission')} rows={segRows(p1.byMission)} />
      </Card>

      <Card title="Product and category performance">
        <Table
          columns={[
            { key: 'category', label: 'Category' },
            { key: 'units_sold', label: 'Units sold', align: 'right', render: (r) => int(r.units_sold) },
            { key: 'revenue', label: 'Revenue', align: 'right', render: (r) => money0(r.revenue) },
            { key: 'share_of_revenue_pct', label: 'Share of revenue', align: 'right', render: (r) => pct(r.share_of_revenue_pct) },
            { key: 'gross_profit', label: 'Gross profit', align: 'right', render: (r) => money0(r.gross_profit) },
            { key: 'margin_pct', label: 'Margin', align: 'right', render: (r) => pct(r.margin_pct) }
          ]}
          rows={p1.categories}
        />
        <div className="grid2" style={{ marginTop: 14 }}>
          <div>
            <h3>Top-selling products (by revenue)</h3>
            <Table columns={productCols} rows={p1.topProducts} />
          </div>
          <div>
            <h3>Weak or slow-selling products (fewest units)</h3>
            <Table columns={productCols} rows={p1.weakProducts} />
          </div>
        </div>
      </Card>

      <Card title="Part 2 - Inventory and autonomous operations" subtitle="What operational problems occurred, and what did the Store Brain do?">
        <h3>Inventory health</h3>
        <div className="stats">
          <Stat label="Stockout events" value={int(inv.stockout_events)} hint="product-days that sold out" tone={inv.stockout_events > 0 ? 'bad' : ''} />
          <Stat label="Low-stock events" value={int(inv.low_stock_events)} />
          <Stat label="Demand lost to stockouts" value={`${int(inv.lost_units)} units`} hint={`about ${money0(inv.lost_revenue)} of sales`} />
          <Stat label="Expired / written off" value={`${int(inv.writeoff_units)} units`} hint={`${money(inv.writeoff_value)} at cost`} />
          <Stat label="Replenishment spend" value={money0(inv.replenishment.spend)} hint={`${int(inv.replenishment.units)} units in ${int(inv.replenishment.orders)} order lines`} />
          <Stat label="Closing inventory" value={money0(inv.closing_value)} hint={`${int(inv.closing_units)} units at cost`} />
        </div>

        <div className="grid2" style={{ marginTop: 14 }}>
          <div>
            <h3>Write-offs by category</h3>
            <Table
              columns={[
                { key: 'category', label: 'Category' },
                { key: 'units', label: 'Units', align: 'right', render: (r) => int(r.units) },
                { key: 'value', label: 'Value at cost', align: 'right', render: (r) => money(r.value) }
              ]}
              rows={inv.expiryByCategory}
              empty="No expired stock (0)"
            />
          </div>
          <div>
            <h3>Replenishment by category</h3>
            <Table
              columns={[
                { key: 'category', label: 'Category' },
                { key: 'orders', label: 'Order lines', align: 'right', render: (r) => int(r.orders) },
                { key: 'units', label: 'Units', align: 'right', render: (r) => int(r.units) },
                { key: 'spend', label: 'Spend', align: 'right', render: (r) => money0(r.spend) }
              ]}
              rows={inv.replenishment.by_category}
            />
          </div>
        </div>

        <h3>Products with the most write-off value</h3>
        <Table
          columns={[
            { key: 'name', label: 'Product', render: productLink },
            { key: 'category', label: 'Category' },
            { key: 'shelf_life_days', label: 'Shelf life', align: 'right', render: (r) => `${r.shelf_life_days} day(s)` },
            { key: 'units', label: 'Units', align: 'right', render: (r) => int(r.units) },
            { key: 'value', label: 'Value at cost', align: 'right', render: (r) => money(r.value) }
          ]}
          rows={inv.expiryByProduct}
          empty="No expired stock (0)"
        />

        <h3>Products that sold out most</h3>
        <Table
          columns={[
            { key: 'name', label: 'Product', render: productLink },
            { key: 'category', label: 'Category' },
            { key: 'sold_out_days', label: 'Sold-out days', align: 'right' },
            { key: 'first_day', label: 'First time', align: 'right', render: (r) => `Day ${r.first_day}` },
            { key: 'lost_units', label: 'Units of demand lost', align: 'right', render: (r) => int(r.lost_units) }
          ]}
          rows={inv.soldOutTop}
          empty="No stockouts (0)"
        />
      </Card>

      <Card title="Store Brain operations" subtitle="Every event type is listed, including those that did not occur (0).">
        <Table
          columns={[
            { key: 'event_type', label: 'Event type', render: (r) => r.event_type.replace(/_/g, ' ') },
            { key: 'events', label: 'Events', align: 'right', render: (r) => int(r.events) },
            { key: 'products', label: 'Products', align: 'right', render: (r) => int(r.products) },
            { key: 'meaning', label: 'Meaning' }
          ]}
          rows={countRows}
        />
        <div className="stats" style={{ marginTop: 14 }}>
          <Stat label="Orders cut back by cash" value={int(brain.cash_constrained_events)} hint="insufficient operating cash" tone={brain.cash_constrained_events > 0 ? 'bad' : 'good'} />
          <Stat label="Lowest cash balance" value={brain.lowest_cash ? money0(brain.lowest_cash.balance) : '-'} hint={brain.lowest_cash ? `Day ${brain.lowest_cash.day}` : ''} />
          <Stat label="Biggest one-day order spend" value={brain.peak_daily_spend ? money0(brain.peak_daily_spend.spend) : '-'} hint={brain.peak_daily_spend ? `Day ${brain.peak_daily_spend.day}` : ''} />
        </div>

        <h3>Condition detected, action taken, recorded outcome</h3>
        <p className="muted">The five products with the most lost demand. Open the day to see the full record.</p>
        {brain.soldOutCases.length === 0 && <p>No sold-out cases (0).</p>}
        {brain.soldOutCases.map((c) => (
          <div key={c.product_id} style={{ marginBottom: 14 }}>
            <b>{c.name}</b>{' '}
            <span className="muted">
              sold out on {c.sold_out_days} day(s); {int(c.lost_units)} units of demand lost in total
            </span>
            <Table
              columns={[
                { key: 'day', label: 'Day', render: dayLink },
                { key: 'detail', label: 'Condition detected' },
                { key: 'action_taken', label: 'Store Brain action' },
                { key: 'recovered_next_day', label: 'Next day', render: (r) => (r.recovered_next_day ? 'Back in stock' : 'Still out or final day') }
              ]}
              rows={c.events}
            />
          </div>
        ))}

        <h3>Slow-mover responses</h3>
        <Table
          maxHeight={300}
          columns={[
            { key: 'day', label: 'Day', render: dayLink },
            { key: 'name', label: 'Product', render: productLink },
            { key: 'detail', label: 'Condition detected' },
            { key: 'action_taken', label: 'Store Brain action' }
          ]}
          rows={brain.slowMovers}
          empty="No slow movers flagged (0)"
        />

        <h3>Closing alerts on the final day</h3>
        <Table
          maxHeight={260}
          columns={[
            { key: 'event_type', label: 'Alert', render: (r) => r.event_type.replace(/_/g, ' ') },
            { key: 'name', label: 'Product', render: productLink },
            { key: 'detail', label: 'Condition' },
            { key: 'action_taken', label: 'Action' }
          ]}
          rows={brain.closingAlerts}
          empty="No closing low-stock or sold-out alerts (0)"
        />
      </Card>

      <Card title="Part 3 - Commercial diagnosis and management recommendations" subtitle="What should the client consider next?">
        {f.loading && <p className="muted">Loading...</p>}
        {f.error && <p className="muted">{f.error}</p>}
        {f.data && f.data.length === 0 && (
          <p className="muted">The written findings are stored when a run is marked as the Submitted Run. None have been stored for this run.</p>
        )}
        {f.data && f.data.map((x) => (
          <div className="finding" key={x.finding_no}>
            <h3>Finding {x.finding_no}: {x.title}</h3>
            <dl>
              <dt>Observation</dt><dd>{x.observation}</dd>
              <dt>Evidence</dt><dd>{x.evidence}</dd>
              <dt>Diagnosis</dt><dd>{x.diagnosis}</dd>
              <dt>Business implication</dt><dd>{x.implication}</dd>
              <dt>Recommendation</dt><dd>{x.recommendation}</dd>
              <dt>Model limitation</dt><dd>{x.limitation}</dd>
            </dl>
          </div>
        ))}
      </Card>
    </>
  );
}