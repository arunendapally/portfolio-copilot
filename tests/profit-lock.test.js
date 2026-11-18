'use strict';
// Spec 002 US4 (T061, T062): profit lock arms, books and trails at the investor's thresholds;
// stops only move up; funds are never in scope; marks only rise and re-base.
const test = require('node:test');
const assert = require('node:assert');
const P = require('../core/lib/profile');
const gtt = require('../core/lib/gtt');
const marksLib = require('../core/lib/marks');
const lockRule = require('../core/lib/rules/profit_lock');
const decisions = require('../core/lib/decisions');
const snapshotLib = require('../core/lib/snapshot');
const { tmpEnv, writeProfile } = require('./helpers');
const { callTool } = require('../core/tools');
const fs = require('fs');
const path = require('path');

const NOW = new Date('2026-11-16T05:00:00Z');
const LOCK = { enabled: true, scope: 'play', arm_gain_pct: 20, book_gain_pct: 40, book_fraction_pct: 50, trail_pct: 10, reentry_cooloff_days: 30, proceeds_to: 'cash' };
const profile = (over = {}) => P.merge(P.DEFAULTS, { gtt_policy: { profit_lock: LOCK }, ...over });
const eq = (symbol, avg, ltp, o = {}) => ({ broker: 'kite', symbol, exchange: 'NSE', type: 'equity', qty: 10, avg, ltp, value: 10 * ltp, pnl: 10 * (ltp - avg), currency: 'INR', ...o });
const g = (id, symbol, stop, qty = 10) => ({ id, symbol, status: 'active', type: 'single', triggers: [stop], legs: [{ side: 'SELL', trigger: stop, qty }] });
const snap = (holdings, gtts = []) => ({ taken_at: NOW.toISOString(), fx: {}, brokers: { kite: { status: 'live', as_of: NOW.toISOString(), holdings, gtts, cash: 0 } } });
const input = (s, prof, marks = null) => ({ snap: s, prev: null, profile: prof, c: snapshotLib.consolidate(s, prof), findings: [], marks, now: NOW, today: '2026-11-16', edition: 'full' });
const lockTasks = (r) => r.all.filter((t) => t.kind.startsWith('profit_lock'));

test('no effect while disabled: no finding, no task, listed as not set', () => {
  const prof = P.merge(P.DEFAULTS, {});
  const s = snap([eq('ALPHA', 100, 130)], [g(1, 'ALPHA', 80)]);
  assert.ok(!gtt.audit(s, null, prof).rows[0].issues.some((i) => i.code === 'gain_unprotected'));
  const r = decisions.evaluate(input(s, prof));
  assert.deepStrictEqual(lockTasks(r), []);
  assert.ok(r.not_set.includes('profit lock'));
});

test('past the arm threshold with the stop below cost: gain_unprotected, a task to raise the stop to cost, placed before the old is deleted', () => {
  const prof = profile();
  const s = snap([eq('ALPHA', 100, 125)], [g(1, 'ALPHA', 80)]);
  const a = gtt.audit(s, null, prof);
  assert.ok(a.rows[0].issues.some((i) => i.code === 'gain_unprotected'));
  const t = lockTasks(decisions.evaluate(input(s, prof)))[0];
  assert.strictEqual(t.kind, 'profit_lock_arm');
  assert.strictEqual(t.why.rule_ref, 'gtt_policy.profit_lock.arm_gain_pct');
  assert.deepStrictEqual(t.expect, { kind: 'gtt_stop', symbol: 'ALPHA', min_stop: 100 });
  const p = gtt.plan(a, s, prof, { lockStops: lockRule.targets(s, prof, null, { ALPHA: 80 }) });
  assert.deepStrictEqual(p.rows.map((r) => r.action), ['place', 'delete']);
  assert.strictEqual(p.rows[0].args.trigger_value, 100);
});

test('armed and past the booking threshold: a task to sell the configured share, with where the proceeds go', () => {
  const prof = profile();
  const s = snap([eq('ALPHA', 100, 145)], [g(1, 'ALPHA', 100)]);
  const marks = { symbols: { ALPHA: { stage: 'armed', high_close: 145 } }, reentry: [] };
  const t = lockTasks(decisions.evaluate(input(s, prof, marks)))[0];
  assert.strictEqual(t.kind, 'profit_lock_book');
  assert.strictEqual(t.executor, 'investor');
  assert.strictEqual(t.options[0].sell.qty, 5);
  assert.ok(t.why.measurements.some((m) => m.name === 'proceeds_to' && m.value === 'cash'));
});

test('trailing: the stop follows the highest close up and never down', () => {
  const prof = profile();
  const up = snap([eq('ALPHA', 100, 160, { qty: 5 })], [g(1, 'ALPHA', 120, 5)]);
  const marks = { symbols: { ALPHA: { stage: 'trailing', high_close: 170 } }, reentry: [] };
  const t = lockTasks(decisions.evaluate(input(up, prof, marks)))[0];
  assert.strictEqual(t.kind, 'profit_lock_trail');
  assert.strictEqual(t.expect.min_stop, 153);
  // The stop already sits above where the trail would put it (153): price fell, nothing moves down.
  const down = snap([eq('ALPHA', 100, 158, { qty: 5 })], [g(1, 'ALPHA', 155, 5)]);
  assert.deepStrictEqual(lockTasks(decisions.evaluate(input(down, prof, marks))), [], 'no task proposes a lower stop');
  const s = lockRule.states(down, prof, marks, LOCK, { ALPHA: 155 })[0];
  assert.strictEqual(s.proposed_stop, 155);
});

test('funds are never in scope; play vs all_stocks', () => {
  const s = snap([eq('NIFTYETF', 100, 150, { type: 'etf' }), eq('COREBANK', 100, 150)], []);
  assert.deepStrictEqual(lockRule.states(s, profile({ classes: { COREBANK: 'core' } }), null, LOCK).map((x) => x.symbol), []);
  const all = profile({ classes: { COREBANK: 'core' }, gtt_policy: { profit_lock: { ...LOCK, scope: 'all_stocks' } } });
  assert.deepStrictEqual(lockRule.states(s, all, null, all.gtt_policy.profit_lock).map((x) => x.symbol), ['COREBANK']);
});

test('locked names are exempt from the minimum stop distance and have their own crash-test column', () => {
  const prof = profile();
  const s = snap([eq('ALPHA', 100, 125)], [g(1, 'ALPHA', 120)]);
  const marks = { symbols: { ALPHA: { stage: 'armed', high_close: 125 } }, reentry: [] };
  const a = gtt.audit(s, null, prof, { marks });
  assert.ok(!a.rows[0].issues.some((i) => i.code === 'stop_too_tight'));
  assert.deepStrictEqual(a.crash[0].locked_names_firing, ['ALPHA']);
  assert.deepStrictEqual(a.crash[0].hold_names_firing, []);
  assert.ok(gtt.audit(s, null, prof).rows[0].issues.some((i) => i.code === 'stop_too_tight'), 'unlocked, the minimum applies');
});

test('the dry run lists what would arm, book or trail and saves nothing', async () => {
  const { folder } = tmpEnv();
  writeProfile(folder, { schema_version: 2 });
  const s = snap([eq('ALPHA', 100, 125), eq('BETA', 100, 150), eq('GAMMA', 100, 105)], [g(1, 'ALPHA', 80)]);
  fs.mkdirSync(path.join(folder, 'portfolio-copilot', 'snapshots'), { recursive: true });
  fs.writeFileSync(path.join(folder, 'portfolio-copilot', 'snapshots', '2026-11-16.json'), JSON.stringify(s));
  const before = fs.readFileSync(path.join(folder, 'portfolio-copilot', 'profile.json'), 'utf8');
  const r = await callTool('profit_lock_dryrun', { folder, arm_gain_pct: 20, book_gain_pct: 40, trail_pct: 10 }, { edition: 'full', now: () => NOW });
  assert.ok(r.ok, r.text);
  assert.deepStrictEqual(r.rows.map((x) => [x.symbol, x.want]), [['ALPHA', 'armed'], ['BETA', 'book'], ['GAMMA', 'idle']]);
  assert.match(r.text, /nothing saved/);
  assert.strictEqual(fs.readFileSync(path.join(folder, 'portfolio-copilot', 'profile.json'), 'utf8'), before);
  assert.ok(!fs.existsSync(path.join(folder, 'portfolio-copilot', 'marks.json')));
});

test('marks: high_close only rises; stages move forward; a full exit resets and lists the re-entry', () => {
  const prof = profile();
  let m = { schema_version: 1, symbols: {}, reentry: [] };
  m = marksLib.update(m, snap([eq('ALPHA', 100, 125)]), prof, { ALPHA: 100 }, new Date('2026-11-16T05:00:00Z'));
  assert.strictEqual(m.symbols.ALPHA.stage, 'armed');
  assert.strictEqual(m.symbols.ALPHA.high_close, 125);
  m = marksLib.update(m, snap([eq('ALPHA', 100, 118)]), prof, { ALPHA: 100 }, new Date('2026-11-17T05:00:00Z'));
  assert.strictEqual(m.symbols.ALPHA.high_close, 125, 'the high does not fall');
  m = marksLib.update(m, snap([eq('ALPHA', 100, 150, { qty: 5 })]), prof, { ALPHA: 100 }, new Date('2026-11-18T05:00:00Z'));
  assert.strictEqual(m.symbols.ALPHA.stage, 'booked');
  m = marksLib.update(m, snap([eq('ALPHA', 100, 152, { qty: 5 })]), prof, { ALPHA: 137 }, new Date('2026-11-19T05:00:00Z'));
  assert.strictEqual(m.symbols.ALPHA.stage, 'trailing');
  m = marksLib.update(m, snap([]), prof, {}, new Date('2026-11-25T05:00:00Z'));
  assert.ok(!m.symbols.ALPHA);
  assert.deepStrictEqual(m.reentry, [{ symbol: 'ALPHA', exited_at: '2026-11-25', by: 'trailing_stop', cooloff_days: 30, needs: 'fresh thesis' }]);
});

test('a confirmed corporate action re-bases high_close and last_stop', () => {
  const m = marksLib.rebase({ symbols: { ALPHA: { high_close: 200, last_stop: 150 } } }, 'ALPHA', 0.5);
  assert.deepStrictEqual([m.symbols.ALPHA.high_close, m.symbols.ALPHA.last_stop], [100, 75]);
});

test('a buy inside the cooling-off after a profit-lock exit is flagged', () => {
  const { tradeAudit } = require('../core/lib/audit');
  const prof = profile();
  const s = snap([eq('ALPHA', 100, 120)]);
  const c = snapshotLib.consolidate(s, prof);
  const f = tradeAudit(s, c, { changes: [{ broker: 'kite', symbol: 'ALPHA', change: 10, cause: 'between sessions' }] }, prof, [{ symbol: 'ALPHA', exited_at: '2026-11-01', cooloff_days: 30, needs: 'fresh thesis' }]);
  assert.ok(f.findings.some((x) => /15 days after its profit-lock exit/.test(x.text)), JSON.stringify(f));
});

test('backtest: a lot that arms, books and is then stopped by the trail', () => {
  const { simulate } = require('../core/bin/backtest-profit-lock');
  const closes = [110, 125, 145, 150, 130].map((close, i) => ({ date: `2026-01-0${i + 2}`, close }));
  const r = simulate({ price: 100, qty: 10, sold: null }, closes, { arm: 20, book: 40, trail: 10, fraction: 50 });
  assert.strictEqual(r.outcome, 'booked, then stopped');
  assert.strictEqual(r.pnl, 5 * 45 + 5 * 35, 'booked 5 at 145, the rest stopped at 135 (10% under the 150 high)');
});

test('an average cost off the 0.05 tick: the cost stop rounds up, so it arms', () => {
  const prof = profile();
  const s = snap([eq('ALPHA', 123.456, 160)], [g(1, 'ALPHA', 80)]);
  const st = lockRule.states(s, prof, null, LOCK, { ALPHA: 80 })[0];
  assert.strictEqual(st.proposed_stop, 123.5, 'at or above cost, never 123.45');
  assert.strictEqual(lockRule.states(snap([eq('ALPHA', 100, 160)]), prof, null, LOCK)[0].proposed_stop, 100, 'a cost on the tick stays put');
  const m = marksLib.update({ schema_version: 1, symbols: {}, reentry: [] }, snap([eq('ALPHA', 123.456, 160)]), prof, { ALPHA: st.proposed_stop }, NOW);
  assert.strictEqual(m.symbols.ALPHA.stage, 'armed');
});

test('marks: a midday spike does not lift the highest close; the previous close or a post-close price does', () => {
  const prof = profile();
  let m = marksLib.update({ schema_version: 1, symbols: {}, reentry: [] }, snap([eq('ALPHA', 100, 125)]), prof, {}, new Date('2026-11-16T11:00:00Z'));
  assert.strictEqual(m.symbols.ALPHA.high_close, 125);
  m = marksLib.update(m, snap([eq('ALPHA', 100, 140)]), prof, {}, new Date('2026-11-17T06:30:00Z'));
  assert.strictEqual(m.symbols.ALPHA.high_close, 125, '12:00 IST is not a close');
  // Kite day_change is the move since the previous close (times qty): 140 - 100 / 10 = 130 closed yesterday.
  m = marksLib.update(m, snap([eq('ALPHA', 100, 140, { day_change: 100 })]), prof, {}, new Date('2026-11-17T06:30:00Z'));
  assert.strictEqual(m.symbols.ALPHA.high_close, 130);
  m = marksLib.update(m, snap([eq('ALPHA', 100, 140)]), prof, {}, new Date('2026-11-17T10:00:00Z'));
  assert.strictEqual(m.symbols.ALPHA.high_close, 140, '15:30 IST and after is the close');
});

test('a trail task keeps its id while the trail level moves', () => {
  const prof = profile();
  const s = snap([eq('ALPHA', 100, 160, { qty: 5 })], [g(1, 'ALPHA', 120, 5)]);
  const id = (high) => lockTasks(decisions.evaluate(input(s, prof, { symbols: { ALPHA: { stage: 'trailing', high_close: high } }, reentry: [] })))[0].id;
  assert.strictEqual(id(170), id(172));
});
