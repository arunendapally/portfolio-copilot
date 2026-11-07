'use strict';
// Issues #28 and #32: with no profile.json the engine silently fell back to defaults (no verdicts,
// no sector map, ETFs known by name only) and drafted wrong GTTs. It must say so, and recognise
// ETFs from their ISIN.
const test = require('node:test');
const assert = require('node:assert');
const { tmpEnv, fixture, writeProfile, fakeBrokers, ctxAt } = require('./helpers');
const { callTool } = require('../core/tools');
const norm = require('../core/lib/brokers/normalize');

const AT = '2026-10-14T05:00:00Z';

async function seeded(withProfile) {
  const { folder } = tmpEnv();
  if (withProfile) writeProfile(folder, fixture('profile.json'));
  const brokers = fakeBrokers({ kite: { data: fixture('kite-book.json') } });
  const ctx = ctxAt(AT, brokers);
  await callTool('refresh', { folder }, ctx);
  return { folder, ctx };
}

test('without profile.json every policy tool says it is using defaults, and names what that skips', async () => {
  const { folder, ctx } = await seeded(false);
  for (const tool of ['refresh', 'check', 'gtt_audit', 'draft_gtt_plan', 'draft_basket', 'crash_check', 'broker_status']) {
    const r = await callTool(tool, { folder, amount: 1000, index_level: 20000 }, ctx);
    assert.match(r.text, /No profile\.json/, `${tool} did not warn`);
    assert.match(r.text, /defaults/i, tool);
    assert.match(r.text, /verdicts/i, tool);
    assert.match(r.text, /sector/i, tool);
    assert.strictEqual(r.profile_missing, true, tool);
  }
});

test('the warning is added in front of the tool output, which still follows, and works on the remembered folder', async () => {
  const { ctx } = await seeded(false);
  const audit = await callTool('gtt_audit', {}, ctx); // no folder: the one remembered from refresh
  assert.strictEqual(audit.ok, true, audit.text);
  assert.match(audit.text, /^\*\*No profile\.json found/);
  assert.match(audit.text, /GTT audit/);
  const check = await callTool('check', {}, ctx);
  assert.strictEqual(check.ok, true, check.text);
  assert.match(check.text, /^\*\*No profile\.json found/);
  assert.match(check.text, /base: all connected brokers/);
});

test('draft_orders never reads the profile, so it carries no profile warning', async () => {
  const { folder, ctx } = await seeded(false);
  const r = await callTool('draft_orders', { folder, rows: [{ tool: 'mcp__kite__cancel_order', args: { order_id: '1' }, symbol: 'SBIN', reason: 'test' }] }, ctx);
  assert.doesNotMatch(r.text, /No profile\.json/);
  assert.ok(!r.profile_missing);
});

test('with a profile.json there is no such warning', async () => {
  const { folder, ctx } = await seeded(true);
  for (const tool of ['check', 'gtt_audit']) {
    const r = await callTool(tool, { folder }, ctx);
    assert.doesNotMatch(r.text, /No profile\.json/, tool);
    assert.ok(!r.profile_missing, tool);
  }
});

test('profile tools are not wrapped: profile_get keeps its own message, profile_update still creates the file', async () => {
  const { folder } = tmpEnv();
  const g = await callTool('profile_get', { folder }, ctxAt(AT));
  assert.match(g.text, /no profile saved yet/);
  assert.doesNotMatch(g.text, /No profile\.json/);
  const u = await callTool('profile_update', { folder, path: 'cash.buffer_min_pct', value: 7 }, ctxAt(AT));
  assert.ok(u.ok, u.text);
  assert.doesNotMatch(u.text, /No profile\.json/);
});

test('an INF-prefixed ISIN is an ETF even when the symbol and the profile do not say so', () => {
  const rows = norm.kiteHoldings([
    { tradingsymbol: 'HDFCSML250', exchange: 'NSE', isin: 'INF179KC1981', quantity: 10, average_price: 100, last_price: 120 },
    { tradingsymbol: 'SBIN', exchange: 'NSE', isin: 'INE062A01020', quantity: 10, average_price: 600, last_price: 800 },
  ], null);
  assert.strictEqual(rows.find((h) => h.symbol === 'HDFCSML250').type, 'etf');
  assert.strictEqual(rows.find((h) => h.symbol === 'SBIN').type, 'equity');
});
