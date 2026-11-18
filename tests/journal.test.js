'use strict';
// Spec 002 US5 (T071): decided tasks are journaled with their measurements; the Friday read-back
// pairs old decisions with what the same rule measures now.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { tmpEnv, fixture, writeProfile, fakeBrokers, ctxAt } = require('./helpers');
const { callTool } = require('../core/tools');
const journal = require('../core/lib/journal');

const TOOLS = ['mcp__kite__get_holdings', 'mcp__kite__get_gtts', 'mcp__kite__get_margins', 'mcp__kite__place_gtt_order', 'mcp__kite__delete_gtt_order'];

async function decideAll(folder, ctx, kind = 'full') {
  await callTool('review_start', { folder, tools: TOOLS, kind }, ctx);
  await callTool('research_submit', { folder, run: `${ctx.now().toISOString().slice(0, 10)}-${kind}`, corporate_actions: [] }, ctx);
  const p = await callTool('review_next', { folder, run: `${ctx.now().toISOString().slice(0, 10)}-${kind}` }, ctx);
  for (const t of p.tasks) await callTool('task_decide', { folder, run: p.run, task: t.id, decision: 'declined', reason: 'testing' }, ctx);
  await callTool('review_next', { folder, run: p.run }, ctx);
  return { p, closed: await callTool('review_next', { folder, run: p.run, record: { todoist: 'synced', dashboard: 'updated' } }, ctx) };
}

test('decided tasks are journaled with their measurements at decision time', async () => {
  const { folder } = tmpEnv();
  writeProfile(folder, { ...fixture('profile.json'), brokers: { kite: { enabled: true }, kotak: { enabled: false } } });
  const ctx = ctxAt('2026-10-14T05:00:00Z', fakeBrokers({ kite: { data: fixture('kite-book.json') } }));
  const { p, closed } = await decideAll(folder, ctx);
  assert.strictEqual(closed.stage, 'closed', closed.text);
  const rows = journal.lines(folder);
  assert.strictEqual(rows.length, p.tasks.length);
  assert.ok(rows.every((r) => r.decision === 'declined' && r.reason === 'testing' && r.why.measurements.length && r.run_id === '2026-10-14-full'));
});

test('the Friday run reads back decisions older than the window beside current measurements', async () => {
  const { folder } = tmpEnv();
  writeProfile(folder, { ...fixture('profile.json'), brokers: { kite: { enabled: true }, kotak: { enabled: false } }, review: { max_tasks: 5, readback_after_days: 28 } });
  const first = ctxAt('2026-10-14T05:00:00Z', fakeBrokers({ kite: { data: fixture('kite-book.json') } }));
  const { p } = await decideAll(folder, first);
  // Too soon: nothing to read back.
  assert.match((await callTool('journal_readback', { folder }, first)).text, /No decisions older than 28 days/);
  const later = ctxAt('2026-11-20T05:00:00Z', fakeBrokers({ kite: { data: fixture('kite-book.json') } }));
  const rb = await callTool('journal_readback', { folder }, later);
  assert.strictEqual(rb.decisions.length, p.tasks.length);
  assert.ok(rb.decisions.every((d) => d.then.length && d.now), 'the same situation still measures now');
  assert.match(rb.text, /declined \(testing\)\. Then: .*Now: /);
  const fri = await callTool('review_start', { folder, tools: TOOLS, kind: 'friday' }, later);
  await callTool('research_submit', { folder, run: fri.run, corporate_actions: [] }, later);
  const r = await callTool('review_next', { folder, run: fri.run }, later);
  assert.match(r.text, /Read-back of earlier decisions:/);
  const run = JSON.parse(fs.readFileSync(path.join(folder, 'portfolio-copilot', 'runs', `${fri.run}.json`), 'utf8'));
  assert.strictEqual(run.stages.evaluate.readback.length, p.tasks.length);
});

test('a decision whose situation is gone reads back as no longer due', () => {
  const { folder } = tmpEnv();
  fs.mkdirSync(path.join(folder, 'portfolio-copilot'), { recursive: true });
  fs.writeFileSync(path.join(folder, 'portfolio-copilot', 'journal.jsonl'), `${JSON.stringify({ id: 't_old', symbol: 'GONE', title: 'Protect GONE', decision: 'approved', decided_at: '2026-09-01T05:00:00Z', why: { rule_ref: 'x', measurements: [{ name: 'share_pct', value: 20 }] } })}\n`);
  const r = journal.readback(folder, { olderThanDays: 28, now: new Date('2026-11-16T05:00:00Z'), current: [] });
  assert.match(r[0].text, /Then: share pct 20\. Now: no longer due\./);
});
