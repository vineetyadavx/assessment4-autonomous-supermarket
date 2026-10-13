import { useEffect, useState } from 'react';

export async function api(path, options) {
  const res = await fetch(`/api${path}`, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export function useApi(path) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  useEffect(() => {
    if (!path) return undefined;
    let cancelled = false;
    setState({ data: null, error: null, loading: true });
    api(path)
      .then((data) => !cancelled && setState({ data, error: null, loading: false }))
      .catch((e) => !cancelled && setState({ data: null, error: e.message, loading: false }));
    return () => {
      cancelled = true;
    };
  }, [path]);
  return state;
}