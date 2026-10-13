import { useCallback, useEffect, useState } from 'react';
import './styles.css';
import { api } from './api.js';
import { Loading, ErrorBox } from './ui.jsx';
import { dateTime } from './format.js';

const pageModules = import.meta.glob('./pages/*.jsx', { eager: true });
const getPage = (name) => pageModules[`./pages/${name}.jsx`]?.default;

const TABS = [
  { id: 'model', label: 'Model Declaration', page: 'ModelPage' },
  { id: 'report', label: '60-Day Commercial Report', page: 'ReportPage' },
  { id: 'daily', label: 'Daily Reports', page: 'DailyPage' },
  { id: 'assurance', label: 'Commercial Assurance', page: 'AssurancePage' }
];

export default function App() {
  const [runsInfo, setRunsInfo] = useState(null);
  const [runId, setRunId] = useState(null);
  const [tab, setTab] = useState('model');
  const [day, setDay] = useState(1);
  const [traceProduct, setTraceProduct] = useState(null);
  const [error, setError] = useState(null);
  const [creating, setCreating] = useState(false);

  const loadRuns = useCallback(async (selectId) => {
    try {
      const info = await api('/runs');
      setRunsInfo(info);
      setRunId((current) => {
        if (selectId) return selectId;
        if (current && info.runs.some((r) => r.run_id === current)) return current;
        const completed = info.runs.filter((r) => r.completed_at);
        return info.submittedRunId || completed[0]?.run_id || null;
      });
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    loadRuns();
  }, [loadRuns]);

  async function createRun() {
    setCreating(true);
    setError(null);
    try {
      const res = await api('/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: 'Marker test run' })
      });
      await loadRuns(res.runId);
      setDay(1);
    } catch (e) {
      setError(e.message);
    } finally {
      setCreating(false);
    }
  }

  const openDay = (d) => {
    setDay(d);
    setTab('daily');
    window.scrollTo(0, 0);
  };

  if (error && !runsInfo) return <div className="app"><ErrorBox message={error} /></div>;
  if (!runsInfo) return <div className="app"><Loading /></div>;

  const runs = runsInfo.runs.filter((r) => r.completed_at);
  const current = runs.find((r) => r.run_id === runId);
  const active = TABS.find((t) => t.id === tab);
  const Page = getPage(active.page);
  const Trace = getPage('ProductTrace');

  return (
    <div className="app">
      <div className="topbar">
        <div>
          <h1>Autonomous Supermarket</h1>
          <div className="muted">Swanston St / Town Hall, Melbourne CBD - 60-day simulation and commercial report</div>
        </div>
        <div className="controls">
          <label className="muted" htmlFor="run-select">Run</label>
          <select id="run-select" value={runId || ''} onChange={(e) => { setRunId(e.target.value); setDay(1); }}>
            {runs.map((r) => (
              <option key={r.run_id} value={r.run_id}>
                {r.run_id} {r.submitted ? '(Submitted Run)' : ''} - {r.label}
              </option>
            ))}
          </select>
          <button className="secondary" onClick={createRun} disabled={creating}>
            {creating ? 'Running 60 days...' : 'Create new run'}
          </button>
        </div>
      </div>

      {error && <ErrorBox message={error} />}

      {current && !!current.submitted && (
        <div className="banner ok">
          Showing the <b>Submitted Run</b> <code>{current.run_id}</code>, completed {dateTime(current.completed_at)}. All four client areas use this run.
        </div>
      )}
      {current && !current.submitted && (
        <div className="banner info">
          Showing run <code>{current.run_id}</code>
          {runsInfo.submittedRunId
            ? <> (not the Submitted Run, which is <code>{runsInfo.submittedRunId}</code>). New runs are stored separately and never change the Submitted Run.</>
            : <> - no Submitted Run has been marked yet.</>}
        </div>
      )}

      <div className="tabs">
        {TABS.map((t) => (
          <button key={t.id} className={`tab ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>{t.label}</button>
        ))}
      </div>

      {!runId && <div className="card">No completed run yet. Click "Create new run".</div>}
      {runId && (Page
        ? <Page key={`${runId}-${tab}`} runId={runId} runInfo={current} day={day} setDay={setDay}
            openDay={openDay} openProduct={setTraceProduct} goTab={setTab} />
        : <div className="card muted">This page is added in the next step.</div>)}

      {traceProduct && Trace && (
        <Trace runId={runId} productId={traceProduct} onClose={() => setTraceProduct(null)} openDay={openDay} />
      )}
    </div>
  );
}