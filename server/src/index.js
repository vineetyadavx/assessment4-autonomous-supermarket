import express from 'express';
import cors from 'cors';
import db, { DB_PATH } from './db.js';

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

app.get('/api/health', (req, res) => {
  const row = db.prepare('SELECT sqlite_version() AS version').get();
  res.json({
    status: 'ok',
    sqliteVersion: row.version,
    databasePath: DB_PATH,
    time: new Date().toISOString()
  });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
