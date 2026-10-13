import { compact } from './format.js';

export function Card({ title, subtitle, right, children, className = '' }) {
  return (
    <section className={`card ${className}`}>
      {(title || right) && (
        <div className="card-head">
          <div>
            {title && <h2>{title}</h2>}
            {subtitle && <p className="muted">{subtitle}</p>}
          </div>
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, hint, tone }) {
  return (
    <div className={`stat ${tone || ''}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {hint && <div className="stat-hint">{hint}</div>}
    </div>
  );
}

export function Badge({ status }) {
  const cls = status === 'PASS' ? 'pass' : status === 'FAIL' ? 'fail' : 'neutral';
  return <span className={`badge ${cls}`}>{status}</span>;
}

export function Loading() {
  return <div className="card muted">Loading...</div>;
}

export function ErrorBox({ message }) {
  return <div className="card error">Something went wrong: {message}</div>;
}

export function Table({ columns, rows, onRowClick, maxHeight, empty = 'None recorded (0)' }) {
  return (
    <div className="table-wrap" style={maxHeight ? { maxHeight } : undefined}>
      <table>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={c.align === 'right' ? 'num' : ''}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className={onRowClick ? 'clickable' : ''} onClick={onRowClick ? () => onRowClick(r) : undefined}>
              {columns.map((c) => (
                <td key={c.key} className={c.align === 'right' ? 'num' : ''}>{c.render ? c.render(r) : r[c.key]}</td>
              ))}
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><td colSpan={columns.length} className="muted">{empty}</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export function ColumnChart({ data, xKey, yKey, color = '#1d4ed8', format = (v) => v, height = 170, onSelect, selectedX }) {
  const W = 720;
  const H = height;
  const padL = 46;
  const padB = 22;
  const padT = 8;
  const max = Math.max(1, ...data.map((d) => d[yKey]));
  const bw = (W - padL) / Math.max(1, data.length);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img">
      {[0, 0.5, 1].map((f) => {
        const y = padT + (H - padT - padB) * (1 - f);
        return (
          <g key={f}>
            <line x1={padL} x2={W} y1={y} y2={y} className="grid" />
            <text x={padL - 4} y={y + 3} textAnchor="end" className="axis">{format(max * f)}</text>
          </g>
        );
      })}
      {data.map((d, i) => {
        const h = (H - padT - padB) * (d[yKey] / max);
        const x = padL + i * bw;
        const selected = selectedX !== undefined && d[xKey] === selectedX;
        const showLabel = data.length <= 20 || i % 5 === 4 || i === 0;
        return (
          <g key={i} onClick={onSelect ? () => onSelect(d) : undefined} style={{ cursor: onSelect ? 'pointer' : 'default' }}>
            <rect x={x + 1} y={H - padB - h} width={Math.max(1, bw - 2)} height={h} fill={selected ? '#dc2626' : color}>
              <title>{`${d[xKey]}: ${format(d[yKey])}`}</title>
            </rect>
            {showLabel && <text x={x + bw / 2} y={H - 6} textAnchor="middle" className="axis">{d[xKey]}</text>}
          </g>
        );
      })}
    </svg>
  );
}

export function LineChart({ data, xKey, series, height = 180 }) {
  const W = 720;
  const H = height;
  const padL = 46;
  const padB = 22;
  const padT = 8;
  const max = Math.max(1, ...series.flatMap((s) => data.map((d) => d[s.key])));
  const n = Math.max(1, data.length - 1);
  const px = (i) => padL + (i / n) * (W - padL - 6);
  const py = (v) => padT + (H - padT - padB) * (1 - v / max);
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img">
        {[0, 0.5, 1].map((f) => {
          const y = padT + (H - padT - padB) * (1 - f);
          return (
            <g key={f}>
              <line x1={padL} x2={W} y1={y} y2={y} className="grid" />
              <text x={padL - 4} y={y + 3} textAnchor="end" className="axis">{compact(max * f)}</text>
            </g>
          );
        })}
        {series.map((s) => (
          <polyline key={s.key} fill="none" stroke={s.color} strokeWidth="2"
            points={data.map((d, i) => `${px(i)},${py(d[s.key])}`).join(' ')} />
        ))}
        {data.map((d, i) =>
          i % 10 === 9 || i === 0 ? (
            <text key={i} x={px(i)} y={H - 6} textAnchor="middle" className="axis">{d[xKey]}</text>
          ) : null
        )}
      </svg>
      <div className="legend">
        {series.map((s) => (
          <span key={s.key}><i style={{ background: s.color }} />{s.label}</span>
        ))}
      </div>
    </div>
  );
}