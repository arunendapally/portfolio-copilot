'use strict';
// Issue #29: IBKR US ETFs ingested with type "etf" were bucketed india_equity, overstating the global gap.
const test = require('node:test');
const assert = require('node:assert');
const { tmpEnv, fixture, writeProfile, ctxAt } = require('./helpers');
const { callTool } = require('../core/tools');
const state = require('../core/lib/state');
const profiles = require('../core/lib/profile');
const snapshotLib = require('../core/lib/snapshot');

const AT = '2026-11-06T05:00:00Z';

async function allocationAfterIngest(rows, currency = 'USD') {
  const { folder } = tmpEnv();
  const profile = fixture('profile.json');
  writeProfile(folder, profile);
  const r = await callTool('ingest', { folder, broker: 'ibkr', currency, fx_rate: 85, fx_source: 'test rate', cash: 0, holdings: rows }, ctxAt(AT));
  assert.ok(r.ok, r.text);
  const c = snapshotLib.consolidate(state.latestSnapshot(folder), profiles.load(folder).profile);
  return Object.fromEntries(c.allocation.map((a) => [a.bucket, a.value]));
}

test('US ETFs ingested from IBKR with type etf land in global_equity, not india_equity', async () => {
  const alloc = await allocationAfterIngest([
    { contract_description: 'VOO', position: 10, market_price: 500, type: 'etf' },
    { contract_description: 'QQQM', position: 5, market_price: 200, type: 'etf' },
  ]);
  assert.strictEqual(alloc.global_equity, (10 * 500 + 5 * 200) * 85);
  assert.ok(!alloc.india_equity, `india_equity should be empty, got ${alloc.india_equity}`);
});

test('a symbol mapped in the profile still wins, and INR ETFs still bucket by name', async () => {
  const { folder } = tmpEnv();
  const profile = fixture('profile.json');
  profile.allocation = { targets: {}, symbol_buckets: { SGLN: 'gold' } };
  writeProfile(folder, profile);
  const snap = { taken_at: AT, fx: { USD: { rate: 85 } }, brokers: { ibkr: { status: 'live', cash: 0, holdings: [
    { symbol: 'SGLN', type: 'etf', qty: 1, value: 100, currency: 'USD' },
    { symbol: 'NIFTYBEES', type: 'etf', qty: 1, value: 100, currency: 'INR' },
  ] } } };
  const alloc = Object.fromEntries(snapshotLib.consolidate(snap, profiles.load(folder).profile).allocation.map((a) => [a.bucket, a.value]));
  assert.strictEqual(alloc.gold, 8500);
  assert.strictEqual(alloc.india_equity, 100);
  assert.ok(!alloc.global_equity);
});
