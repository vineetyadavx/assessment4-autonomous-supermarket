import db from './db.js';
import { runSimulation } from './engine.js';
import { createBrain } from './brain.js';
import { getAssurance, getSummary } from './reports.js';

const label = process.argv[2] || 'CLI run';
const t0 = Date.now();
const { runId, closingCash } = runSimulation({ db, brain: createBrain(), label });
console.log(`Created ${runId} in ${Date.now() - t0} ms, closing cash A$${closingCash.toFixed(2)}`);

const a = getAssurance(runId);
console.log(`\nAssurance: ${a.overall} (${a.checks_passed}/${a.checks_total} checks passed)`);
for (const c of a.checks) console.log(`  ${c.status}  [${c.area}] ${c.name}: expected ${c.expected}, actual ${c.actual}`);

const s = getSummary(runId);
const st = s.part1.store;
console.log(`\nRevenue A$${st.revenue}, gross profit A$${st.gross_profit} (${st.gross_margin_pct}%), write-offs A$${st.writeoff_value}`);
console.log('Store Brain events: ' + s.part2.brain.counts.map((c) => `${c.event_type}=${c.events}`).join(', '));