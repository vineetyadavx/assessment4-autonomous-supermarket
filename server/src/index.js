import express from 'express';
import cors from 'cors';
import db, { DB_PATH } from './db.js';
import { runSimulation } from './engine.js';
import { createBrain } from './brain.js';
import {
  listRuns, getSubmittedRunId, getModel, getSummary, getDaily, getDayTransactions,
  getTransaction, getProductTrace, getAssurance, getFindings
} from './reports.js';

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

const wrap = (fn) => (req, res, next) => {
  try {
    res.json(fn(req));
  } catch (e) {
    next(e);
  }
};

app.get('/api/health', (req, res) => {
  const row = db.prepare('SELECT sqlite_version() AS version').get();
  res.json({ status: 'ok', sqliteVersion: row.version, databasePath: DB_PATH, time: new Date().toISOString() });
});

// Runs. There is deliberately no update or delete route: history is append-only.
app.get('/api/runs', wrap(() => ({ submittedRunId: getSubmittedRunId(), runs: listRuns() })));

app.post('/api/runs', (req, res, next) => {
  try {
    const label = String(req.body?.label || 'Simulation run').slice(0, 80);
    const result = runSimulation({ db, brain: createBrain(), label });
    res.status(201).json(result);
  } catch (e) {
    next(e);
  }
});

app.get('/api/runs/:runId/model', wrap((req) => getModel(req.params.runId)));
app.get('/api/runs/:runId/summary', wrap((req) => getSummary(req.params.runId)));
app.get('/api/runs/:runId/findings', wrap((req) => getFindings(req.params.runId)));
app.get('/api/runs/:runId/assurance', wrap((req) => getAssurance(req.params.runId)));
app.get('/api/runs/:runId/days/:day', wrap((req) => getDaily(req.params.runId, req.params.day)));
app.get('/api/runs/:runId/days/:day/transactions', wrap((req) =>
  getDayTransactions(req.params.runId, req.params.day, req.query.offset, req.query.limit)));
app.get('/api/runs/:runId/transactions/:txnId', wrap((req) => getTransaction(req.params.runId, req.params.txnId)));
app.get('/api/runs/:runId/products/:productId', wrap((req) => getProductTrace(req.params.runId, req.params.productId)));

app.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status === 500) console.error(err);
  res.status(status).json({ error: err.message });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});