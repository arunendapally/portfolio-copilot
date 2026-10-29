'use strict';
// US3: GTT audit under the investor's policy. Every seeded issue in fixtures/kite-book.json
// must be found (SC-006).
const test = require('node:test');
const assert = require('node:assert');
const { tmpEnv, fixture, writeProfile, fakeBrokers, ctxAt } = require('./helpers');
const { callTool } = require('../core/tools');
const gtt = require('../core/lib/gtt');
const profiles = require('../core/lib/profile');
const norm = require('../core/lib/brokers/normalize');

function snapOf(book, profile) {
  return { taken_at: '2026-10-14T05:00:00Z', brokers: { kite: { status: 'live', as_of: '2026-10-14T05:00:00Z', holdings: norm.kiteHoldings(book.holdings, profile), gtts: norm.kiteGtts(book.gtts), orders: [] } } };
}

function profile() {
  return profiles.merge(profiles.DEFAULTS, fixture('profile.json'));
}

const SEEDED = {
  SBIN: ['stop_too_tight'],
  ICICIBANK: ['qty_short'],
  NIFTYBEES: ['etf_stop', 'qty_excess'],
  MID150BEES: ['qty_short'],
  JIOFIN: ['exit_stop', 'exit_missing'],
  TATAPOWER: ['stop_too_tight', 'near_stop'],
  HDFCBANK: ['no_gtt'],
  LUPIN: ['double_coverage'],
};

test('audit finds 100% of seeded issues', () => {
  const p = profile();
  const a = gtt.audit(snapOf(fixture('kite-book.json'), p), null, p);
  for (const [sym, codes] of Object.entries(SEEDED)) {
    const row = a.rows.find((r) => r.symbol === sym);
    assert.ok(row, `${sym} missing`);
    for (const c of codes) assert.ok(row.issues.some((i) => i.code === c), `${sym}: expected ${c}, got ${row.issues.map((i) => i.code)}`);
  }
  assert.deepStrictEqual(a.orphans.map((o) => o.symbol), ['COALINDIA']);
  assert.deepStrictEqual(a.inactive.map((g) => g.symbol), ['HDFCBANK']);
});

test('quantity gap reports units and value', () => {
  const p = profile();
  const a = gtt.audit(snapOf(fixture('kite-book.json'), p), null, p);
  const mid = a.rows.find((r) => r.symbol === 'MID150BEES').issues.find((i) => i.code === 'qty_short');
  assert.strictEqual(mid.gap, 9);
  assert.strictEqual(mid.gap_value, 1980);
});

test('crash test lists hold names that fire at -20% and fails', () => {
  const p = profile();
  const a = gtt.audit(snapOf(fixture('kite-book.json'), p), null, p);
  const at20 = a.crash.find((c) => c.move_pct === -20);
  assert.deepStrictEqual(at20.hold_names_firing.sort(), ['SBIN', 'TATAPOWER']);
  assert.strictEqual(a.summary.crash_test_pass, false);
  assert.deepStrictEqual(a.crash.find((c) => c.move_pct === -10).hold_names_firing, ['TATAPOWER']);
});

test('proximity uses live price, never the price stored at GTT creation', () => {
  const p = profile();
  const book = fixture('kite-book.json');
  book.gtts.find((g) => g.id === 6).condition.last_price = 10000; // stale creation price
  const a = gtt.audit(snapOf(book, p), null, p);
  assert.strictEqual(a.rows.find((r) => r.symbol === 'TATAPOWER').stop_distance_pct, 1.8);
});

test('profile overrides change the policy and are respected', () => {
  const p = profile();
  p.gtt_policy.min_stop_distance_pct = 10;
  p.gtt_policy.etf_stop = true;
  const a = gtt.audit(snapOf(fixture('kite-book.json'), p), null, p);
  assert.ok(!a.rows.find((r) => r.symbol === 'SBIN').issues.some((i) => i.code === 'stop_too_tight'));
  assert.ok(!a.rows.find((r) => r.symbol === 'NIFTYBEES').issues.some((i) => i.code === 'etf_stop'));
});

test('bonus issue re-scores stops against the adjusted price', () => {
  const p = profile();
  const a = gtt.audit(snapOf(fixture('kite-book.json'), p), null, p, { corporateActions: [{ symbol: 'ICICIBANK', kind: 'bonus', ratio: '1:1', ex_date: '2026-10-20', confirmed: false }] });
  const ca = a.rows.find((r) => r.symbol === 'ICICIBANK').issues.find((i) => i.code === 'corp_action');
  assert.strictEqual(ca.severity, 'critical');
  assert.match(ca.text, /adjusted price about 600.*GTT 2 would fire/);
  assert.match(ca.text, /unconfirmed/);
  assert.strictEqual(gtt.priceFactor({ kind: 'split', ratio: '10:2' }), 0.2);
});

test('GTTs that vanished since the last snapshot are reported', () => {
  const p = profile();
  const prev = snapOf(fixture('kite-book.json'), p);
  const cur = fixture('kite-book.json');
  cur.gtts = cur.gtts.filter((g) => g.id !== 2);
  const a = gtt.audit(snapOf(cur, p), prev, p);
  assert.deepStrictEqual(a.vanished, [{ id: 2, symbol: 'ICICIBANK' }]);
});

test('plan places every replacement before any delete', () => {
  const p = profile();
  const s = snapOf(fixture('kite-book.json'), p);
  const plan = gtt.plan(gtt.audit(s, null, p), s, p);
  const firstDelete = plan.rows.findIndex((r) => r.action === 'delete');
  const lastPlace = plan.rows.map((r) => r.action).lastIndexOf('place');
  assert.ok(lastPlace < firstDelete);
  const sbin = plan.rows.find((r) => r.action === 'place' && r.symbol === 'SBIN');
  assert.strictEqual(sbin.args.trigger_type, 'two-leg');
  assert.strictEqual(sbin.args.lower_trigger_value, 600); // 25% below 800
  assert.strictEqual(sbin.args.upper_trigger_value, 1000); // target kept
  const jio = plan.rows.find((r) => r.action === 'place' && r.symbol === 'JIOFIN');
  assert.deepStrictEqual([jio.args.trigger_type, jio.args.trigger_value, jio.args.quantity], ['single', 260, 200]);
  const nifty = plan.rows.find((r) => r.action === 'place' && r.symbol === 'NIFTYBEES');
  assert.deepStrictEqual([nifty.args.trigger_type, nifty.args.trigger_value, nifty.args.quantity], ['single', 320, 470]);
  assert.ok(plan.rows.some((r) => r.action === 'delete' && r.gtt_id === 10), 'orphan delete missing');
  assert.ok(!plan.rows.some((r) => r.action === 'place' && r.args.trigger_type === 'two-leg' && r.args.lower_trigger_value > r.args.last_price * 0.8 + 0.01), 'a planned stop is tighter than 20%');
});

test('a replacement GTT keeps the exchange of the GTT it replaces (smoke, 15-Oct)', () => {
  const p = profile();
  const book = JSON.parse(JSON.stringify(fixture('kite-book.json')));
  const g = book.gtts.find((x) => (x.condition || {}).tradingsymbol === 'SBIN');
  g.condition.exchange = 'BSE';
  const s = snapOf(book, p);
  const sbin = gtt.plan(gtt.audit(s, null, p), s, p).rows.find((r) => r.action === 'place' && r.symbol === 'SBIN');
  assert.strictEqual(sbin.args.exchange, 'BSE');
});

test('gtt_audit tool marks findings unverified when Kite is not live today', async () => {
  const { folder } = tmpEnv();
  writeProfile(folder, fixture('profile.json'));
  const brokers = fakeBrokers({ kite: { data: fixture('kite-book.json') }, kotak: { status: { status: 'disabled' } } });
  await callTool('refresh', { folder }, ctxAt('2026-10-13T05:00:00Z', brokers));
  const r = await callTool('gtt_audit', { folder }, ctxAt('2026-10-14T05:00:00Z', brokers));
  assert.ok(r.unverified);
  assert.match(r.text, /UNVERIFIED/);
  const d = await callTool('draft_gtt_plan', { folder }, ctxAt('2026-10-14T05:00:00Z', brokers));
  assert.strictEqual(d.ok, false);
});

test('a keep decision holds the stop until review_by, in audit, crash test and plan', () => {
  const p = profile();
  const book = fixture('kite-book.json');
  p.verdicts.SBIN.stop_review = { decision: 'keep', at: '2026-10-13', reason: 'weakening', review_by: '2026-11-10' };
  const a = gtt.audit(snapOf(book, p), null, p, { today: '2026-10-14' });
  const sbin = a.rows.find((r) => r.symbol === 'SBIN');
  assert.ok(!sbin.issues.some((i) => i.code === 'stop_too_tight'));
  assert.match(sbin.issues.find((i) => i.code === 'stop_kept').text, /kept by decision on 2026-10-13/);
  const at20 = a.crash.find((c) => c.move_pct === -20);
  assert.deepStrictEqual(at20.hold_names_firing, ['TATAPOWER']);
  assert.deepStrictEqual(at20.kept_names_firing, ['SBIN']);
  assert.ok(!require('../core/lib/crash').stopReview(a.rows, p.gtt_policy).some((r) => r.symbol === 'SBIN'));
  const s = snapOf(book, p);
  assert.ok(!gtt.plan(a, s, p).rows.some((r) => r.symbol === 'SBIN'), 'plan must not widen a kept stop');
});

test('a keep decision lapses after review_by and invalid ones are rejected', () => {
  const p = profile();
  p.verdicts.SBIN.stop_review = { decision: 'keep', at: '2026-10-13', review_by: '2026-10-20' };
  const a = gtt.audit(snapOf(fixture('kite-book.json'), p), null, p, { today: '2026-10-21' });
  assert.ok(a.rows.find((r) => r.symbol === 'SBIN').issues.some((i) => i.code === 'stop_too_tight'));
  p.verdicts.SBIN.stop_review = { decision: 'maybe' };
  assert.ok(profiles.validate(p).some((e) => /stop_review\.decision/.test(e)));
});
