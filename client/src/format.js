export const num = (n, d = 1) =>
    n === null || n === undefined ? '-' : Number(n).toLocaleString('en-AU', { minimumFractionDigits: d, maximumFractionDigits: d });
  export const money = (n, d = 2) => (n === null || n === undefined ? '-' : 'A$' + num(n, d));
  export const money0 = (n) => money(n, 0);
  export const int = (n) => (n === null || n === undefined ? '-' : Number(n).toLocaleString('en-AU'));
  export const pct = (n, d = 1) => (n === null || n === undefined ? '-' : num(n, d) + '%');
  export const hourLabel = (h) => String(h).padStart(2, '0') + ':00';
  export const dateTime = (iso) =>
    iso ? new Date(iso).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' }) : '-';
  export const compact = (n) => {
    const a = Math.abs(n);
    if (a >= 1e6) return `${Number((n / 1e6).toFixed(1))}M`;
    if (a >= 1e3) return `${Number((n / 1e3).toFixed(1))}k`;
    return String(Number(n.toFixed(1)));
  };