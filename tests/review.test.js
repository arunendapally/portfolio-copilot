'use strict';
// Spec 002 US3 (T040, T041, T042, T044): the guided review run on the fixture book.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { tmpEnv, fixture, writeProfile, fakeBrokers, ctxAt } = require('./helpers');
const { callTool } = require('../core/tools');
const drafts = require('../core/lib/drafts');
const review = require('../core/lib/review');
const tasks = require('../core/lib/tasks');

const T0 = '2026-10-14T05:00:00Z';
const TOOLS = ['mcp__kite__get_holdings', 'mcp__kite__get_gtts', 'mcp__kite__get_margins', 'mcp__kite__place_gtt_order', 'mcp__kite__delete_gtt_order'];

function setup(extra = {}) {
  const { folder } = tmpEnv();
  writeProfile(folder, { ...fixture('profile.json'), brokers: { kite: { enabled: true }, kotak: { enabled: false } }, ...extra });
  const ctx = ctxAt(T0, fakeBrokers({ kite: { data: fixture('kite-book.json') } }));
  return { folder, ctx };
}

async function toPropose(folder, ctx) {
  await callTool('review_start', { folder, tools: TOOLS }, ctx);
  await callTool('research_submit', { folder, corporate_actions: [] }, ctx);
  return callTool('review_next', { folder }, ctx);
}

const byTitle = (r, re) => r.tasks.find((t) => re.test(t.title));

test('stages run in order and stop at a gate that needs something', async () => {
  const { folder, ctx } = setup();
  const s = await callTool('review_start', { folder, tools: TOOLS }, ctx);
  assert.strictEqual(s.stage, 'research', 'connect and pull pass on a live Kite');
  assert.strictEqual(s.gate.pass, false);
  assert.deepStrictEqual(s.gate.needs, ['corporate-action check for held stocks']);
  assert.strictEqual(s.next[0].do, 'research');
  const run = review.load(folder, '2026-10-14-full');
  assert.deepStrictEqual(['connect', 'pull'].map((k) => run.stages[k].status), ['passed', 'passed']);
  assert.strictEqual(run.stages.research.status, 'waiting');
});

test('a second review_start the same day resumes the same run', async () => {
  const { folder, ctx } = setup();
  await callTool('review_start', { folder, tools: TOOLS }, ctx);
  const again = await callTool('review_start', { folder, tools: TOOLS }, ctx);
  assert.strictEqual(again.resumed, true);
  assert.strictEqual(again.run, '2026-10-14-full');
});

test('propose shows at most five tasks, safety first, with also_due, and asks with Approve, Defer, Decline', async () => {
  const { folder, ctx } = setup();
  const r = await toPropose(folder, ctx);
  assert.strictEqual(r.stage, 'propose');
  assert.ok(r.tasks.length <= tasks.CAP);
  assert.ok(r.tasks.every((t, i, a) => i === 0 || a[i - 1].priority <= t.priority));
  assert.match(r.text, /Also due: \d+/);
  const q = r.next[0].question.questions[0];
  assert.strictEqual(q.header, r.tasks[0].id);
  assert.deepStrictEqual(q.options.map((o) => o.label), ['Approve', 'Defer', 'Decline']);
  assert.ok(!q.options.some((o) => /Yes, place/.test(o.label)));
});

test('full flow: approve one, defer one, decline the rest; draft, Yes click, fresh read, confirmed, recorded', async () => {
  const { folder, ctx } = setup();
  const p = await toPropose(folder, ctx);
  const icici = byTitle(p, /ICICIBANK/);
  const hdfc = byTitle(p, /HDFCBANK/);
  for (const t of p.tasks) {
    const decision = t === icici ? 'approved' : t === hdfc ? 'deferred' : 'declined';
    const r = await callTool('task_decide', { folder, task: t.id, decision, defer_until: '2026-10-20', reason: 'test' }, ctx);
    assert.ok(r.ok, r.text);
  }
  const e = await callTool('review_next', { folder }, ctx);
  assert.strictEqual(e.stage, 'execute');
  const ask = e.next.find((s) => s.do === 'ask');
  const code = ask.question.questions[0].header;
  assert.ok(ask.question.questions[0].options.some((o) => o.label === `Yes, place ${code}`));
  const calls = e.next.filter((s) => s.do === 'call');
  assert.ok(calls.length >= 1 && calls.every((c) => c.only_if === `Yes, place ${code}`));
  // Nothing is executed until every row of the approved draft was used by the gate.
  assert.strictEqual((await callTool('review_next', { folder }, ctx)).stage, 'execute');
  drafts.approve(folder, code, new Date(T0));
  drafts.load(folder, code).rows.forEach((_, i) => drafts.claimRow(folder, code, i));
  // The broker now holds a GTT for all 69 ICICIBANK, read after the change.
  const book = fixture('kite-book.json');
  book.gtts.find((g) => g.condition.tradingsymbol === 'ICICIBANK').orders[0].quantity = 69;
  ctxAt('2026-10-14T05:10:00Z', fakeBrokers({ kite: { data: book } }));
  const later = { edition: 'full', now: () => new Date('2026-10-14T05:10:00Z') };
  const rec = await callTool('review_next', { folder }, later);
  // Record waits until Todoist and the dashboard were updated.
  assert.strictEqual(rec.stage, 'record', rec.text);
  assert.deepStrictEqual(rec.gate.needs, ['Todoist', 'dashboard']);
  const ops = rec.next.find((s) => s.do === 'todoist').ops;
  const dash = rec.next.find((s) => s.do === 'dashboard');
  assert.ok(dash.files.some((f) => /positions-2026-10-14\.json$/.test(f)));
  const half = await callTool('review_next', { folder, record: { todoist: 'synced' } }, later);
  assert.strictEqual(half.stage, 'record');
  assert.deepStrictEqual(half.gate.needs, ['dashboard']);
  const done = await callTool('review_next', { folder, record: { dashboard: 'updated' } }, later);
  assert.strictEqual(done.stage, 'closed', done.text);
  assert.strictEqual(done.tasks.find((t) => t.id === icici.id).outcome, 'confirmed');
  assert.match(done.text, /Run closed · 1 done, 1 deferred, 0 blocked · log, journal, bundle, Todoist, dashboard updated/);
  assert.deepStrictEqual(ops.find((o) => o.external_id === `pc:${icici.id}`).op, 'complete');
  assert.strictEqual(ops.find((o) => o.external_id === `pc:${hdfc.id}`).due, '2026-10-20');
  const journal = fs.readFileSync(path.join(folder, 'portfolio-copilot', 'journal.jsonl'), 'utf8').trim().split('\n');
  assert.strictEqual(journal.length, p.tasks.length);
  assert.ok(fs.existsSync(path.join(folder, 'portfolio-copilot', 'bundle.json')));
});

test('an executed change the fresh read does not show blocks the run from closing', async () => {
  const { folder, ctx } = setup();
  const p = await toPropose(folder, ctx);
  const icici = byTitle(p, /ICICIBANK/);
  for (const t of p.tasks) await callTool('task_decide', { folder, task: t.id, decision: t === icici ? 'approved' : 'declined' }, ctx);
  const e = await callTool('review_next', { folder }, ctx);
  const code = e.next.find((s) => s.do === 'ask').question.questions[0].header;
  drafts.approve(folder, code, new Date(T0));
  drafts.load(folder, code).rows.forEach((_, i) => drafts.claimRow(folder, code, i));
  ctxAt('2026-10-14T05:10:00Z', fakeBrokers({ kite: { data: fixture('kite-book.json') } })); // unchanged
  const r = await callTool('review_next', { folder }, { edition: 'full', now: () => new Date('2026-10-14T05:10:00Z') });
  assert.strictEqual(r.stage, 'verify');
  assert.strictEqual(r.gate.pass, false);
  assert.match(r.gate.reason, /not confirmed/);
});

test('a deferred task is not proposed again before defer_until, and task ids are stable across days', async () => {
  const { folder, ctx } = setup();
  const p = await toPropose(folder, ctx);
  const first = p.tasks[0];
  for (const t of p.tasks) await callTool('task_decide', { folder, task: t.id, decision: t === first ? 'deferred' : 'declined', defer_until: '2026-10-20' }, ctx);
  // Close the run: nothing approved, so execute and verify pass straight to record.
  await callTool('review_next', { folder }, ctx);
  const closed = await callTool('review_next', { folder, record: { todoist: 'synced', dashboard: 'updated' } }, ctx);
  assert.strictEqual(closed.stage, 'closed', closed.text);
  const nextDay = ctxAt('2026-10-15T05:00:00Z', fakeBrokers({ kite: { data: fixture('kite-book.json') } }));
  const q = await toPropose(folder, nextDay);
  assert.ok(!q.tasks.some((t) => t.id === first.id), 'deferred task came back early');
  assert.ok(q.tasks.some((t) => p.tasks.some((x) => x.id === t.id)), 'declined tasks keep their ids');
});

test('the lite edition makes GTT tasks the investor\'s, with manual steps and task_done', async () => {
  const { folder } = setup();
  const ctx = { ...ctxAt(T0, fakeBrokers({ kite: { data: fixture('kite-book.json') } })), edition: 'lite' };
  const p = await toPropose(folder, ctx);
  assert.ok(p.tasks.every((t) => t.executor === 'investor'));
  const t = p.tasks[0];
  for (const x of p.tasks) await callTool('task_decide', { folder, task: x.id, decision: x === t ? 'approved' : 'declined' }, ctx);
  const e = await callTool('review_next', { folder }, ctx);
  const m = e.next.find((s) => s.do === 'manual');
  assert.strictEqual(m.task, t.id);
  assert.match(m.steps[0], /^1\. Open Kite web/);
  const d = await callTool('task_done', { folder, task: t.id, result: 'done' }, ctx);
  assert.strictEqual(d.task.outcome, 'handed_over');
});

test('unattended stops before propose and waits; end of day skips research, propose, execute and verify', async () => {
  const a = setup();
  await callTool('review_start', { folder: a.folder, tools: TOOLS, unattended: true }, a.ctx);
  const r = await callTool('research_submit', { folder: a.folder, corporate_actions: [] }, a.ctx);
  assert.ok(r.ok);
  const u = await callTool('review_next', { folder: a.folder }, a.ctx);
  assert.strictEqual(u.stage, 'propose');
  assert.strictEqual(u.gate.pass, false);
  assert.match(u.gate.reason, /unattended: waiting for you/);
  assert.deepStrictEqual(u.next, [], 'nothing is asked while the investor is away');
  assert.ok(u.tasks.length > 0, 'the tasks are listed for later');
  // The investor picks it up: the same run asks its questions.
  const back = await callTool('review_start', { folder: a.folder, tools: TOOLS }, a.ctx);
  assert.strictEqual(back.resumed, true);
  assert.strictEqual(back.stage, 'propose');
  assert.strictEqual(back.next[0].do, 'ask');
  const b = setup();
  const eod = await callTool('review_start', { folder: b.folder, tools: TOOLS, kind: 'eod' }, b.ctx);
  assert.strictEqual(eod.stage, 'record', eod.text);
  const skipped = await callTool('review_next', { folder: b.folder, run: '2026-10-14-eod', record: { todoist: 'skipped', dashboard: 'updated' } }, b.ctx);
  assert.strictEqual(skipped.stage, 'closed');
  assert.match(skipped.text, /not updated \(you said skip\): todoist/);
  assert.deepStrictEqual(Object.keys(review.load(b.folder, '2026-10-14-eod').stages), ['connect', 'pull', 'evaluate', 'record']);
});

test('the profile is frozen for the run', async () => {
  const { folder, ctx } = setup();
  await callTool('review_start', { folder, tools: TOOLS }, ctx);
  await callTool('profile_update', { folder, path: 'gtt_policy.min_stop_distance_pct', value: 5 }, ctx);
  const r = await callTool('review_next', { folder }, ctx);
  assert.match(r.text, /profile changed since this run started/);
  assert.strictEqual(review.load(folder, '2026-10-14-full').profile.gtt_policy.min_stop_distance_pct, 20);
});

test('research findings: validated, not_found satisfies the gate, accepted ones appended to findings.jsonl', async () => {
  const { folder, ctx } = setup({ verdicts: { ...fixture('profile.json').verdicts, SBIN: { stance: 'hold', reason: 'x', tripwires: [{ id: 'g', metric: 'sales_growth_yoy_pct', below: 0 }] } } });
  const s = await callTool('review_start', { folder, tools: TOOLS }, ctx);
  assert.deepStrictEqual(s.gate.needs.slice(0, 1), ['SBIN sales_growth_yoy_pct']);
  const good = { symbol: 'SBIN', metric: 'sales_growth_yoy_pct', status: 'not_found', period: 'Q2 FY27', source_url: 'https://example.org/sbin', accessed: '2026-10-14' };
  const bad = [
    { ...good, symbol: 'ZZZ' },
    { ...good, metric: 'vibes' },
    { ...good, status: 'found' },
    { ...good, value: 3 },
    { ...good, source_url: 'ftp://x' },
    { ...good, accessed: '2026-10-15' },
    { ...good, period: '' },
  ];
  const r = await callTool('research_submit', { folder, findings: [...bad, good], corporate_actions: [] }, ctx);
  assert.strictEqual(r.accepted.length, 1);
  assert.strictEqual(r.rejected.length, bad.length);
  const lines = fs.readFileSync(path.join(folder, 'portfolio-copilot', 'findings.jsonl'), 'utf8').trim().split('\n');
  assert.strictEqual(JSON.parse(lines[0]).run_id, '2026-10-14-full');
  const n = await callTool('review_next', { folder }, ctx);
  assert.strictEqual(n.stage, 'propose');
});

test('verify checks each expect kind against the audit row', () => {
  const row = (o) => ({ issues: [], stop: null, target: null, ...o });
  assert.ok(review.check({ kind: 'gtt_qty' }, row({})));
  assert.ok(!review.check({ kind: 'gtt_qty' }, row({ issues: [{ code: 'qty_short' }] })));
  assert.ok(!review.check({ kind: 'gtt_qty', exact: true }, row({ issues: [{ code: 'double_coverage' }] })));
  assert.ok(review.check({ kind: 'gtt_stop', none: true }, row({ stop: null })));
  assert.ok(!review.check({ kind: 'gtt_stop', none: true }, row({ stop: 90 })));
  assert.ok(review.check({ kind: 'gtt_stop', max_stop: 80 }, row({ stop: 79 })));
  assert.ok(review.check({ kind: 'gtt_target', target: 260 }, row({ target: 259 })));
  assert.ok(review.check({ kind: 'none' }, undefined));
});

test('each option shows its drift effect and says when tax is not computed', async () => {
  const { folder, ctx } = setup();
  const p = await toPropose(folder, ctx);
  assert.match(p.text, /Effect: none on allocation; no sale, no tax/);
  const P = require('../core/lib/profile');
  const effects = require('../core/lib/effects');
  const snapshotLib = require('../core/lib/snapshot');
  const prof = P.merge(P.DEFAULTS, { allocation: { targets: { india_equity: 80 } } });
  const snap = { taken_at: T0, fx: {}, brokers: { kite: { holdings: [{ symbol: 'A', type: 'equity', qty: 10, ltp: 100, value: 1000, currency: 'INR' }], cash: 0 } } };
  const e = effects.forOption({ sell: { symbol: 'A', qty: 3 } }, { snap, c: snapshotLib.consolidate(snap, prof), profile: prof });
  assert.deepStrictEqual(e.allocation.map((a) => [a.bucket, a.before_pct, a.after_pct]), [['india_equity', 100, 70], ['cash', 0, 30]]);
  assert.match(effects.line(e), /india equity 100% → 70% \(target 80%\).*tax not computed: load your tradebook/);
});

test('task_decide is refused outside propose and execute; a decision is never an order', async () => {
  const { folder, ctx } = setup();
  const s = await callTool('review_start', { folder, tools: TOOLS }, ctx);
  const r = await callTool('task_decide', { folder, task: 't_x', decision: 'approved' }, ctx);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(s.stage, 'research');
});
