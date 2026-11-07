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
const USD_ETFS = [
  { contract_description: 'VOO', position: 10, market_price: 500, type: 'etf' },
  { contract_description: 'QQQM', position: 5, market_price: 200, type: 'etf' },
];

async function ingested(rows, currency = 'USD') {
  const { folder } = tmpEnv();
  writeProfile(folder, fixture('profile.json'));
  const ctx = ctxAt(AT);
  const r = await callTool('ingest', { folder, broker: 'ibkr', currency, fx_rate: 85, fx_source: 'test rate', cash: 0, holdings: rows }, ctx);
  assert.ok(r.ok, r.text);
  return { folder, ctx };
}

function buckets(snap, profile) {
  return Object.fromEntries(snapshotLib.consolidate(snap, profile).allocation.map((a) => [a.bucket, a.value]));
}

test('US ETFs ingested from IBKR with type etf land in global_equity, not india_equity', async () => {
  const { folder } = await ingested(USD_ETFS);
  const alloc = buckets(state.latestSnapshot(folder), profiles.load(folder).profile);
  assert.strictEqual(alloc.global_equity, (10 * 500 + 5 * 200) * 85);
  assert.strictEqual(alloc.india_equity, undefined);
});

test('rate_map calls them foreign equity, not unclassified', async () => {
  const { folder, ctx } = await ingested(USD_ETFS);
  const r = await callTool('rate_map', { folder }, ctx);
  assert.deepStrictEqual(r.groups.least.map((x) => x.symbol).sort(), ['QQQM', 'VOO']);
  assert.deepStrictEqual(r.groups.unknown, []);
});

test('a profile mapping wins over the currency rule', () => {
  const { folder } = tmpEnv();
  const raw = fixture('profile.json');
  raw.allocation = { targets: {}, symbol_buckets: { SGLN: 'gold' } };
  writeProfile(folder, raw);
  const snap = { taken_at: AT, fx: { USD: { rate: 85 } }, brokers: { ibkr: { status: 'live', cash: 0, holdings: [{ symbol: 'SGLN', type: 'etf', qty: 1, value: 100, currency: 'USD' }] } } };
  const alloc = buckets(snap, profiles.load(folder).profile);
  assert.strictEqual(alloc.gold, 8500);
  assert.strictEqual(alloc.global_equity, undefined);
});

test('INR holdings still bucket by name, and a plain INR ETF stays india_equity', () => {
  const { folder } = tmpEnv();
  writeProfile(folder, fixture('profile.json'));
  const snap = { taken_at: AT, fx: {}, brokers: { kite: { status: 'live', cash: 0, holdings: [
    { symbol: 'GOLDBEES', type: 'etf', qty: 1, value: 100, currency: 'INR' },
    { symbol: 'NIFTYBEES', type: 'etf', qty: 1, value: 200, currency: 'INR' },
  ] } } };
  const alloc = buckets(snap, profiles.load(folder).profile);
  assert.strictEqual(alloc.gold, 100);
  assert.strictEqual(alloc.india_equity, 200);
  assert.strictEqual(alloc.global_equity, undefined);
});
