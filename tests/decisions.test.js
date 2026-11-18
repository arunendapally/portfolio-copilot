'use strict';
// Spec 002 US5 (T070, T079): each rule fires on its fixture and stays silent below its
// threshold, names its base, reports "not set" for a missing threshold, and is deterministic.
const test = require('node:test');
const assert = require('node:assert');
const P = require('../core/lib/profile');
const snapshotLib = require('../core/lib/snapshot');
const decisions = require('../core/lib/decisions');
const drift = require('../core/lib/rules/drift');
const contributions = require('../core/lib/rules/contributions');

const NOW = new Date('2026-11-16T05:00:00Z');
const profile = (over = {}) => P.merge(P.DEFAULTS, over);
const eq = (symbol, value, o = {}) => ({ broker: 'kite', symbol, exchange: 'NSE', type: 'equity', qty: 1, avg: value, ltp: value, value, pnl: 0, currency: 'INR', ...o });

function input(holdings, prof, { cash = 0, findings = [] } = {}) {
  const snap = { taken_at: NOW.toISOString(), fx: {}, brokers: { kite: { status: 'live', as_of: NOW.toISOString(), holdings, gtts: [], cash } } };
  return { snap, prev: null, profile: prof, c: snapshotLib.consolidate(snap, prof), findings, now: NOW, today: '2026-11-16', edition: 'full' };
}
const kinds = (r) => r.tasks.map((t) => `${t.kind}:${t.symbol}`).sort();
// GTT gaps are not under test here: give every holding an ETF type unless it is the stock tested.
const quiet = (rows) => rows.map((h) => ({ ...h, type: h.type === 'equity' && !h.keep ? 'etf' : h.type }));

test('single stock and sector limits fire above the limit with the base named, and stay silent below', () => {
  const prof = profile({ sectors: { BANKA: 'financials', BANKB: 'financials' }, limits: { sector_base: 'book' } });
  const r = decisions.evaluate(input(quiet([eq('BANKA', 200, { keep: true }), eq('BANKB', 150, { keep: true }), eq('OTHER', 650)]), prof));
  const stock = r.tasks.find((t) => t.kind === 'limit_stock');
  assert.strictEqual(stock.symbol, 'BANKA');
  assert.match(stock.why.measurements[0].base, /whole book/);
  const sector = r.tasks.find((t) => t.kind === 'limit_sector');
  assert.strictEqual(sector.symbol, 'financials');
  assert.strictEqual(sector.why.measurements[0].value, 35);
  assert.match(sector.why.measurements[0].base, /whole book/);
  const calm = decisions.evaluate(input(quiet([eq('BANKA', 100, { keep: true }), eq('OTHER', 900)]), profile({ sectors: { BANKA: 'financials' }, limits: { sector_base: 'book' } })));
  assert.ok(!calm.tasks.some((t) => t.kind.startsWith('limit')), JSON.stringify(kinds(calm)));
});

test('a sector fund counts toward its sector when the map lists it', () => {
  const prof = profile({ sectors: { BANKA: 'financials', BANKETF: 'financials' }, limits: { sector_base: 'book', single_stock_pct: 100 } });
  const without = decisions.evaluate(input(quiet([eq('BANKA', 250, { keep: true }), eq('BANKETF', 200, { type: 'etf' }), eq('OTHER', 550)]), profile({ sectors: { BANKA: 'financials' }, limits: { sector_base: 'book', single_stock_pct: 100 } })));
  assert.ok(!without.tasks.some((t) => t.kind === 'limit_sector'));
  const withFund = decisions.evaluate(input(quiet([eq('BANKA', 250, { keep: true }), eq('BANKETF', 200, { type: 'etf' }), eq('OTHER', 550)]), prof));
  assert.strictEqual(withFund.tasks.find((t) => t.kind === 'limit_sector').why.measurements[0].value, 45);
});

test('drift: outside the band proposes new money with the amount; no band is "not set"', () => {
  const prof = profile({ allocation: { targets: { india_equity: 60, gold: 40 }, bands_pp: { india_equity: 5, gold: 5 } }, limits: { single_stock_pct: 100 } });
  const r = decisions.evaluate(input(quiet([eq('NIFTYETF', 800, { type: 'etf' }), eq('GOLDETF', 200, { type: 'etf' })]), prof));
  const gold = r.tasks.find((t) => t.kind === 'drift' && t.symbol === 'gold');
  assert.ok(gold);
  const money = gold.why.measurements.find((m) => m.name === 'new_money_inr').value;
  assert.strictEqual(money, drift.newMoney(200, 1000, 40));
  assert.strictEqual(money, 333);
  assert.match(gold.options[0].label, /new money/);
  const noBand = decisions.evaluate(input(quiet([eq('NIFTYETF', 800, { type: 'etf' }), eq('GOLDETF', 200, { type: 'etf' })]), profile({ allocation: { targets: { india_equity: 60, gold: 40 } } })));
  assert.ok(!noBand.tasks.some((t) => t.kind === 'drift'));
  assert.ok(noBand.not_set.some((n) => /drift bands \(india_equity, gold\)/.test(n)));
});

test('tripwires fire only on a sourced finding that crosses for the required quarters', () => {
  const verdicts = { ALPHA: { stance: 'hold', reason: 'x', on_tripwire: 'exit', tripwires: [{ id: 'm', metric: 'ebitda_margin_pct', below: 20, for_quarters: 2 }] } };
  const f = (period, value, status = 'found') => ({ symbol: 'ALPHA', metric: 'ebitda_margin_pct', period, value, status, source_url: 'https://x', accessed: '2026-11-10' });
  const prof = profile({ verdicts, limits: { single_stock_pct: 100 } });
  const holdings = [eq('ALPHA', 100, { type: 'etf' })];
  assert.ok(!decisions.evaluate(input(holdings, prof, { findings: [f('Q1', 18)] })).tasks.some((t) => t.kind === 'tripwire'), 'one quarter is not enough');
  assert.ok(!decisions.evaluate(input(holdings, prof, { findings: [f('Q1', 18), { ...f('Q2'), status: 'not_found', value: undefined }] })).tasks.some((t) => t.kind === 'tripwire'), 'not found never triggers');
  const r = decisions.evaluate(input(holdings, prof, { findings: [f('Q1', 18), f('Q2', 17)] }));
  const t = r.tasks.find((x) => x.kind === 'tripwire');
  assert.strictEqual(t.priority, 1, 'an exit tripwire is a safety task');
  assert.strictEqual(t.why.findings[1].source_url, 'https://x');
  assert.match(t.options[0].label, /Exit as your verdict says/);
});

test('plan path: behind by more than the tolerance shows the monthly change; missing values are not set', () => {
  const plan = { start: '2026-01-01', start_book_inr: 1000000, return_pct: 12, monthly: [{ from: '2026-01', amount_inr: 50000 }], step_up_pct: null, step_up_month: null, behind_tolerance_pct: 5 };
  const path = contributions.pathValue(plan, NOW);
  assert.ok(path > 1000000 + 10 * 50000);
  const prof = profile({ plan, limits: { single_stock_pct: 100 } });
  const r = decisions.evaluate(input([eq('NIFTYETF', 1000000, { type: 'etf' })], prof));
  const t = r.tasks.find((x) => x.kind === 'contribution');
  assert.ok(t);
  const extra = t.why.measurements.find((m) => m.name === 'extra_monthly_inr').value;
  assert.strictEqual(extra, contributions.extraMonthly(Math.round(path - 1000000), 12));
  const onTrack = decisions.evaluate(input([eq('NIFTYETF', Math.round(path), { type: 'etf' })], prof));
  assert.ok(!onTrack.tasks.some((x) => x.kind === 'contribution'));
  assert.ok(decisions.evaluate(input([eq('NIFTYETF', 1, { type: 'etf' })], profile())).not_set.includes('plan path'));
});

test('loss tolerance counts realised plus open losses on play trades, says when realised is missing', () => {
  const prof = profile({ loss_tolerance: { amount_inr: 1000, from: '2026-04-01', to: null, measure: 'realised_plus_open' }, limits: { single_stock_pct: 100 } });
  const holdings = [eq('PLAYCO', 500, { pnl: -1500, type: 'etf', keep: false }), eq('COREETF', 500, { type: 'etf', pnl: -5000 })];
  const prof2 = profile({ ...prof, classes: { PLAYCO: 'play' } });
  const r = decisions.evaluate(input(holdings, prof2));
  const t = r.tasks.find((x) => x.why.rule_ref === 'loss_tolerance.amount_inr');
  assert.ok(t, JSON.stringify(kinds(r)));
  assert.strictEqual(t.why.measurements[0].value, 1500, 'only play losses count; the core ETF is excluded');
  assert.match(t.why.measurements[0].base, /realised losses not counted/);
  assert.ok(decisions.evaluate(input(holdings, profile())).not_set.includes('loss tolerance'));
});

test('same inputs, same tasks and ids; priority order and the cap of five', () => {
  const prof = profile({ sectors: {}, limits: { single_stock_pct: 5 } });
  const rows = Array.from({ length: 8 }, (_, i) => eq(`S${i}`, 100 + i, { keep: true }));
  const a = decisions.evaluate(input(rows, prof));
  const b = decisions.evaluate(input(rows, prof));
  assert.deepStrictEqual(a.tasks.map((t) => t.id), b.tasks.map((t) => t.id));
  assert.strictEqual(a.tasks.length, 5);
  assert.ok(a.also_due > 0);
  assert.ok(a.tasks.every((t, i, x) => i === 0 || x[i - 1].priority <= t.priority));
  assert.strictEqual(a.tasks[0].kind, 'gtt_gap', 'safety first');
});
