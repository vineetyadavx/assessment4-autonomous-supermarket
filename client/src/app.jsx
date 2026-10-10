import { useEffect, useState } from 'react';

export default function App() {
  const [health, setHealth] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch('/api/health')
      .then((r) => r.json())
      .then(setHealth)
      .catch((e) => setError(e.message));
  }, []);

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', padding: 24 }}>
      <h1>Autonomous Supermarket</h1>
      <p>Swanston Street, Melbourne CBD - 60-day simulation prototype</p>
      {error && <p style={{ color: 'crimson' }}>Backend not reachable: {error}</p>}
      {!health && !error && <p>Checking backend...</p>}
      {health && (
        <pre style={{ background: '#f4f4f4', padding: 12 }}>
          {JSON.stringify(health, null, 2)}
        </pre>
      )}
    </div>
  );
}