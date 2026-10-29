'use strict';
// US5 basket, US6 crash mode, rate map, US7 profile and log tools.
const test = require('node:test');
const assert = require('node:assert');
const { tmpEnv, fixture, writeProfile, fakeBrokers, ctxAt } = require('./helpers');
const { callTool } = require('../core/tools');
const drafts = require('../core/lib/drafts');

const NOW = '2026-10-14T05:00:00Z';

async function ready(profilePatch = (p) => p) {
  const { folder } = tmpEnv();
  writeProfile(folder, profilePatch(fixture('profile.json')));
  const brokers = fakeBrokers({ kite: { data: fixture('kite-book.json'), ltp: { 'NSE:NIFTY 50': 22800 } }, kotak: { status: { status: 'disabled' } } });
  const ctx = ctxAt(NOW, brokers);
  await callTool('refresh', { folder }, ctx);
  return { folder, ctx, brokers };
}

test('basket rows stay within target and LIMIT is slightly above last price', async () => {
  const { folder, ctx } = await ready();
  const r = await callTool('draft_basket', { folder, amount: 100000 }, ctx);
  const rows = drafts.load(folder, r.code).rows;
  const nifty = rows.find((x) => x.symbol === 'NIFTYBEES');
  assert.strictEqual(nifty.limit_price, 280.85);
  assert.ok(nifty.amount <= 60000 && 60000 - nifty.amount < nifty.limit_price);
  assert.ok(Math.abs(r.total - rows.reduce((a, x) => a + x.amount, 0)) < 0.01);
  assert.match(r.text, /Yes, place D/);
  assert.match(r.text, /place_order \{"variety":"regular","exchange":"NSE","tradingsymbol":"NIFTYBEES","transaction_type":"BUY","quantity":213,"product":"CNC","order_type":"LIMIT","price":280.85\}/);
  assert.deepStrictEqual([nifty.tool, nifty.args.quantity, nifty.args.price], ['place_order', 213, 280.85]);
  const lite = await callTool('draft_basket', { folder, amount: 100000 }, { ...ctx, edition: 'lite' });
  assert.match(lite.text, /press Execute yourself/);
});

test('basket flags verdict conflicts and cash shortfall', async () => {
  const { folder, ctx } = await ready();
  const r = await callTool('draft_basket', { folder, amount: 200000, destinations: [{ symbol: 'JIOFIN', weight_pct: 100 }] }, ctx);
  assert.ok(r.conflicts.some((c) => /JIOFIN: verdict is EXIT/.test(c)));
  assert.ok(r.conflicts.some((c) => /exceeds available broker cash/.test(c)));
});

test('crash mode reports the stage from the saved plan and drafts only that stage', async () => {
  const { folder, ctx } = await ready();
  const r = await callTool('crash_check', { folder }, ctx);
  assert.strictEqual(r.stage, 1); // 22800 is below 23500, above 22000
  assert.ok(r.draft);
  assert.strictEqual(drafts.load(folder, r.draft).amount, 250000);
  assert.match(r.text, /SBIN: stop 700 .*widen/);
  assert.match(r.text, /Never tighten stops/);
  assert.doesNotMatch(r.text, /trail/i);
});

test('crash mode reads the corpus live, skips done stages and names missing fields (issue #6)', async () => {
  const patch = (p) => {
    p.deployment_plan.corpus_inr = null;
    p.deployment_plan.corpus_source = 'emerging equity'; // Kite Coin lists funds by ISIN; match the name
    p.deployment_plan.stages[0].done_at = '2026-10-07';
    return p;
  };
  const { folder, ctx } = await ready(patch);
  const arb = require('../core/lib/state').latestSnapshot(folder).brokers.kite.holdings.find((h) => /Emerging Equity/.test(h.name || ''));
  assert.ok(arb, 'fixture has the fund');
  const r = await callTool('crash_check', { folder, index_level: 21500 }, ctx); // stage 1 done, stage 2 reached
  assert.match(r.text, /done 2026-10-07/);
  const d = drafts.load(folder, r.draft);
  assert.ok(Math.abs(d.amount - (arb.value * 35) / 100) < 0.01, `stage 2 is 35% of the live arbitrage value, got ${d.amount}`);
  assert.match(d.label, /stage 2 .*Kotak Emerging Equity Fund/);

  const none = await ready((p) => { p.deployment_plan.corpus_inr = null; return p; });
  const m = await callTool('crash_check', { folder: none.folder, index_level: 22800 }, none.ctx);
  assert.match(m.text, /Stage 1 reached, but deployment_plan\.corpus_source \(or corpus_inr\) is not saved/);
});

test('crash mode drafts nothing without a saved plan', async () => {
  const { folder, ctx } = await ready((p) => ({ ...p, deployment_plan: { stages: [], destinations: [] } }));
  const r = await callTool('crash_check', { folder, index_level: 21000 }, ctx);
  assert.strictEqual(r.stage, null);
  assert.match(r.text, /No staged deployment plan saved/);
});

test('rate map uses defaults and honours overrides', async () => {
  const { folder, ctx } = await ready((p) => ({ ...p, rate_overrides: { LUPIN: 'most' } }));
  const r = await callTool('rate_map', { folder }, ctx);
  const where = (s) => Object.entries(r.groups).find(([, xs]) => xs.some((x) => x.symbol === s))[0];
  assert.strictEqual(where('JIOFIN'), 'most');
  assert.strictEqual(where('MID150BEES'), 'most');
  assert.strictEqual(where('SBIN'), 'mixed');
  assert.strictEqual(where('TATAPOWER'), 'least');
  assert.strictEqual(where('LUPIN'), 'most');
  assert.match(r.text, /RBI policy meeting/);
});

test('profile_update validates and later checks use the new value', async () => {
  const { folder, ctx } = await ready();
  const bad = await callTool('profile_update', { folder, path: 'verdicts.SBIN', value: { stance: 'buy more' } }, ctx);
  assert.strictEqual(bad.ok, false);
  await callTool('profile_update', { folder, path: 'limits.single_stock_pct', value: 1 }, ctx);
  const r = await callTool('check', { folder }, ctx);
  assert.ok(r.alerts.some((a) => /limit 1%/.test(a.text)));
});

test('log_append writes Start here and stays small', async () => {
  const { folder, ctx } = await ready();
  const r = await callTool('log_append', { folder, text: 'checked', start_here: 'Goal: 1 Cr by 2035' }, ctx);
  assert.ok(r.bytes < 20000);
});
