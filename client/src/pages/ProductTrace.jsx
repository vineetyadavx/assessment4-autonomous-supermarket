import { useApi } from '../api.js';
import { Stat, Table, LineChart, Loading } from '../ui.jsx';
import { money, int, num } from '../format.js';

export default function ProductTrace({ runId, productId, onClose, openDay }) {
  const { data, error, loading } = useApi(`/runs/${runId}/products/${productId}`);

  const goDay = (d) => {
    onClose();
    openDay(d);
  };
  const dayLink = (r) => <button className="link" onClick={() => goDay(r.day)}>Day {r.day}</button>;

  let body = null;
  if (loading) body = <Loading />;
  else if (error) body = <p>{error}</p>;
  else {
    const { product: p, series, events, orders } = data;
    const sum = (k) => series.reduce((s, r) => s + r[k], 0);
    const received = sum('received');
    const sold = sum('sold');
    const expired = sum('expired');
    const opening = sum('opening');
    const closing = series[series.length - 1]?.closing ?? 0;
    const eventCounts = {};
    for (const e of events) eventCounts[e.event_type] = (eventCounts[e.event_type] || 0) + 1;
    const eventSummary = Object.entries(eventCounts).map(([k, v]) => `${k.replace(/_/g, ' ')} ${v}`).join(', ');

    body = (
      <>
        <p className="muted">
          {p.product_id} - {p.category} - cost {money(p.unit_cost)}, price {money(p.unit_price)} -{' '}
          {p.perishable ? `perishable, ${p.shelf_life_days}-day shelf life` : 'non-perishable'} - popularity weight {p.popularity}
        </p>
        <div className="stats">
          <Stat label="Opening stock" value={int(opening)} />
          <Stat label="Received" value={int(received)} />
          <Stat label="Sold" value={int(sold)} hint={`${num(sold / series.length)} per day`} />
          <Stat label="Expired" value={int(expired)} />
          <Stat label="Closing stock" value={int(closing)} hint={`${int(opening)} + ${int(received)} - ${int(sold)} - ${int(expired)}`} />
          <Stat label="Revenue" value={money(sum('revenue'))} />
          <Stat label="Demand lost" value={int(sum('lost'))} hint="units, stockouts" />
        </div>
        <p className="muted">Store Brain events for this product: {eventSummary || 'none (0)'}</p>

        <h3>Stock and sales over the run</h3>
        <LineChart
          data={series}
          xKey="day"
          series={[
            { key: 'closing', label: 'Closing stock', color: '#1d4ed8' },
            { key: 'sold', label: 'Units sold', color: '#0f766e' }
          ]}
        />

        <h3>Day by day (click a day for its Daily Report)</h3>
        <Table
          maxHeight={300}
          columns={[
            { key: 'day', label: 'Day', render: dayLink },
            { key: 'opening', label: 'Opening stock', align: 'right' },
            { key: 'received', label: 'Received', align: 'right' },
            { key: 'sold', label: 'Sold', align: 'right' },
            { key: 'expired', label: 'Expired', align: 'right' },
            { key: 'lost', label: 'Lost demand', align: 'right' },
            { key: 'closing', label: 'Closing stock', align: 'right' }
          ]}
          rows={series}
        />

        <h3>Store Brain events</h3>
        <Table
          maxHeight={260}
          columns={[
            { key: 'day', label: 'Day', render: dayLink },
            { key: 'event_type', label: 'Event', render: (r) => r.event_type.replace(/_/g, ' ') },
            { key: 'detail', label: 'Condition detected' },
            { key: 'action_taken', label: 'Action taken' }
          ]}
          rows={events}
          empty="No events (0)"
        />

        <h3>Replenishment orders</h3>
        <Table
          maxHeight={260}
          columns={[
            { key: 'day_placed', label: 'Placed', render: (r) => <button className="link" onClick={() => goDay(r.day_placed)}>Day {r.day_placed}</button> },
            { key: 'day_due', label: 'Arrived', render: (r) => `Day ${r.day_due}` },
            { key: 'requested_qty', label: 'Wanted', align: 'right' },
            { key: 'ordered_qty', label: 'Ordered', align: 'right' },
            { key: 'line_cost', label: 'Cost', align: 'right', render: (r) => money(r.line_cost) },
            { key: 'reason', label: 'Why' }
          ]}
          rows={orders}
          empty="No orders (0)"
        />
      </>
    );
  }

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="card-head">
          <h2>{data ? data.product.name : 'Product trace'}</h2>
          <button className="secondary" onClick={onClose}>Close</button>
        </div>
        {body}
      </div>
    </div>
  );
}