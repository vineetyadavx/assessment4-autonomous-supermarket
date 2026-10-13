import { useMemo, useState } from 'react';
import { useApi } from '../api.js';
import { Card, Stat, Table, Loading, ErrorBox } from '../ui.jsx';
import { money, money0, int, dateTime } from '../format.js';

const share = (x) => `${Math.round(x * 100)}%`;
const mixText = (obj) => Object.entries(obj).map(([k, w]) => `${k.replace(/_/g, ' ')} ${share(w)}`).join(', ');

export default function ModelPage({ runId, openProduct }) {
  const { data, error, loading } = useApi(`/runs/${runId}/model`);
  const [cat, setCat] = useState('All');
  const [q, setQ] = useState('');

  const shown = useMemo(() => {
    if (!data) return [];
    const needle = q.trim().toLowerCase();
    return data.products.filter(
      (p) => (cat === 'All' || p.category === cat) &&
        (!needle || p.name.toLowerCase().includes(needle) || p.product_id.toLowerCase().includes(needle))
    );
  }, [data, cat, q]);

  if (loading) return <Loading />;
  if (error) return <ErrorBox message={error} />;

  const { run, completed, config, products, openingInventoryCost, categories } = data;
  const m = config.model;
  const b = config.brain;
  const hours = m.tradingHours;
  const peaks = (arr) =>
    arr.map((v, i) => [v, i]).sort((x, y) => y[0] - x[0]).slice(0, 2)
      .map(([, i]) => `${String(hours[i]).padStart(2, '0')}:00`).join(' and ');

  const typeRows = Object.entries(m.customerTypes).map(([k, c]) => ({
    name: k, description: c.description, weekday: share(c.shareWeekday), weekend: share(c.shareWeekend),
    peak: peaks(c.hourly), missions: mixText(c.missions)
  }));
  const missionRows = Object.entries(m.missions).map(([k, c]) => ({
    name: k.replace(/_/g, ' '), description: c.description, items: c.meanItems, multi: share(c.multiBuyProb),
    cats: mixText(c.categoryWeights), timing: c.hourFactor ? `Peaks ${peaks(c.hourFactor)}` : 'Any hour'
  }));
  const eventRows = m.events.map((e) => ({
    name: e.name, days: e.days.join(', '), customers: `x${e.customerMultiplier}`,
    effects: [
      ...Object.entries(e.typeShareMultiplier || {}).map(([k, v]) => `${k} share x${v}`),
      ...Object.entries(e.categoryMultiplier || {}).map(([k, v]) => `${k} demand x${v}`)
    ].join('; ') || '-'
  }));
  const brainRows = Object.entries(b)
    .filter(([k]) => k !== 'name' && k !== 'description')
    .map(([key, v]) => ({ key, value: typeof v === 'object' ? JSON.stringify(v) : String(v) }));
  const perishCount = products.filter((p) => p.perishable).length;
  const maxPop = Math.max(...products.map((p) => p.popularity));
  const minPop = Math.min(...products.map((p) => p.popularity));

  return (
    <>
      <Card title="Run configuration" subtitle="Frozen when the run started. A change to any assumption means a new run.">
        <div className="stats">
          <Stat label="Run ID" value={<span style={{ fontSize: 14 }}>{run.run_id}</span>} />
          <Stat label="Status" value={completed ? 'Completed' : 'Incomplete'} hint={completed ? `${completed.days_completed}/${run.num_days} days` : ''} tone={completed ? 'good' : 'bad'} />
          <Stat label="Started" value={<span style={{ fontSize: 14 }}>{dateTime(run.created_at)}</span>} />
          <Stat label="Random seed" value={run.seed} />
          <Stat label="Opening inventory budget" value={money0(run.inventory_budget)} hint="maximum" />
          <Stat label="Opening inventory cost" value={money(openingInventoryCost)} hint="within budget" />
          <Stat label="Opening operating cash" value={money0(run.opening_cash)} hint="Day 1 replenishment" />
          <Stat label="Products" value={products.length} hint={`${perishCount} perishable`} />
        </div>
      </Card>

      <Card title="Model declaration" subtitle="The material assumptions behind this run's results.">
        <ol className="decl">
          <li>
            <b>Customer activity.</b> Each day starts from an expected customer count: {m.baseCustomers.weekday} on weekdays,{' '}
            {m.baseCustomers.saturday} on Saturdays and {m.baseCustomers.sunday} on Sundays (Day 1 is a Monday). A random
            day-to-day variation (standard deviation {Math.round(m.dailyNoiseSd * 100)}%) is applied and declared events scale it.
            The day's customers are split into four customer types using weekday or weekend shares, then spread across the
            trading hours (06:00 to 22:59) using each type's own hourly profile. Arrivals in each type and hour are Poisson draws.
          </li>
          <li>
            <b>Shopping behaviour and product demand.</b> Every customer picks a shopping mission from a mix that depends on their
            type (and on the hour for some missions). The mission sets the basket size, category preference and the chance of
            buying more than one unit. Products inside a category are chosen in proportion to a popularity weight, which ranges
            from {minPop} to {maxPop} here, so demand is uneven rather than uniform. If the wanted product is out of stock,{' '}
            {Math.round(m.substituteProb * 100)}% of customers switch to an in-stock product in the same category; otherwise the
            demand is recorded as a lost sale. A customer never buys more than is on hand.
          </li>
          <li>
            <b>Perishables and shelf life.</b> Every delivery creates its own stock lot with an expiry day (day received plus shelf
            life). Sales take from the earliest-expiring lot first. At the start of each day, any lot that has reached its expiry
            day is removed from sale and written off at cost, so expired stock can never be sold. Non-perishable products have no expiry.
          </li>
          <li>
            <b>How the Store Brain identifies conditions.</b> It reviews the closing state each day and estimates tomorrow's
            demand from the last {b.windowDays} days of sales plus lost demand, adjusted for weekday or weekend traffic.
            <i> Sold out</i>: stock reached zero during the day. <i>Low stock</i>: sellable stock is below {b.lowStockCoverDays} day
            of expected demand. <i>Expiry warning</i>: units in lots expiring within {b.expiryWarningDays} days that are unlikely
            to sell in time. <i>Slow mover</i>: stock on hand exceeds {b.slowMoverCoverDays} days of recent sales
            (or the shelf life, for perishables).
          </li>
          <li>
            <b>Replenishment under the cash limit.</b> Orders are placed after close, paid for from operating cash at that moment,
            and arrive before opening the next day (one-day lead time). No order is placed after Day {run.num_days}. Each order
            tops stock up to a target of expected demand over the cover period plus safety stock. Orders are funded in priority
            order (sold out, then low stock, then routine; highest expected gross profit first) and each order is cut to what
            the remaining cash can pay for. Any reduction is recorded as a cash-constrained event.
          </li>
          <li>
            <b>Other assumptions that affect the result.</b> Prices and costs are fixed for the whole run; no markdowns are used.
            Suppliers have no minimum order sizes and always deliver in full. There is no theft, damage or shrinkage, and
            customers do not react to price. Margins are convenience-store style (about 39% to 52% by category), higher than a
            typical large supermarket. Premises, rent, staff, utilities and overheads are outside the model boundary, so gross profit
            is not net profit. The model is a pre-operational prototype and needs real operating data for calibration.
          </li>
        </ol>
      </Card>

      <div className="grid2">
        <Card title="Customer types" subtitle="Share of the day's customers and typical busy hours.">
          <Table
            columns={[
              { key: 'name', label: 'Type' },
              { key: 'description', label: 'Behaviour' },
              { key: 'weekday', label: 'Weekday', align: 'right' },
              { key: 'weekend', label: 'Weekend', align: 'right' },
              { key: 'peak', label: 'Peak hours' },
              { key: 'missions', label: 'Mission mix' }
            ]}
            rows={typeRows}
          />
        </Card>
        <Card title="Shopping missions" subtitle="Why a customer comes in decides the basket.">
          <Table
            columns={[
              { key: 'name', label: 'Mission' },
              { key: 'items', label: 'Avg items', align: 'right' },
              { key: 'multi', label: 'Multi-buy', align: 'right' },
              { key: 'cats', label: 'Category preference' },
              { key: 'timing', label: 'Timing' }
            ]}
            rows={missionRows}
          />
        </Card>
      </div>

      <div className="grid2">
        <Card title="Declared special events" subtitle="Explain unusual days in the results.">
          <Table
            columns={[
              { key: 'name', label: 'Event' },
              { key: 'days', label: 'Days' },
              { key: 'customers', label: 'Customers', align: 'right' },
              { key: 'effects', label: 'Other effects' }
            ]}
            rows={eventRows}
          />
        </Card>
        <Card title={`Store Brain rules: ${b.name}`} subtitle={b.description}>
          <Table columns={[{ key: 'key', label: 'Parameter' }, { key: 'value', label: 'Value' }]} rows={brainRows} maxHeight={260} />
        </Card>
      </div>

      <Card title="Opening inventory by category">
        <Table
          columns={[
            { key: 'category', label: 'Category' },
            { key: 'products', label: 'Products', align: 'right' },
            { key: 'perishable', label: 'Perishable', align: 'right' },
            { key: 'opening_units', label: 'Opening units', align: 'right', render: (r) => int(r.opening_units) },
            { key: 'opening_cost', label: 'Cost at purchase price', align: 'right', render: (r) => money(r.opening_cost) }
          ]}
          rows={categories}
        />
      </Card>

      <Card
        title="Product data"
        subtitle="Click a product to trace its stock, sales and Store Brain actions across the run."
        right={
          <div className="controls" style={{ display: 'flex', gap: 8 }}>
            <input type="text" placeholder="Search products" value={q} onChange={(e) => setQ(e.target.value)} />
            <select value={cat} onChange={(e) => setCat(e.target.value)}>
              <option>All</option>
              {categories.map((c) => <option key={c.category}>{c.category}</option>)}
            </select>
          </div>
        }
      >
        <Table
          maxHeight={420}
          onRowClick={(p) => openProduct && openProduct(p.product_id)}
          columns={[
            { key: 'product_id', label: 'ID' },
            { key: 'name', label: 'Product' },
            { key: 'category', label: 'Category' },
            { key: 'unit_cost', label: 'Cost', align: 'right', render: (p) => money(p.unit_cost) },
            { key: 'unit_price', label: 'Price', align: 'right', render: (p) => money(p.unit_price) },
            { key: 'margin', label: 'Margin', align: 'right', render: (p) => `${(((p.unit_price - p.unit_cost) / p.unit_price) * 100).toFixed(0)}%` },
            { key: 'initial_qty', label: 'Opening qty', align: 'right', render: (p) => int(p.initial_qty) },
            { key: 'perishable', label: 'Shelf life', render: (p) => (p.perishable ? `${p.shelf_life_days} day(s)` : 'Non-perishable') },
            { key: 'popularity', label: 'Popularity', align: 'right' }
          ]}
          rows={shown}
        />
      </Card>
    </>
  );
}