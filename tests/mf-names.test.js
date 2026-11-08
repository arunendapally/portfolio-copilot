'use strict';
// Issue #30: "Largest positions" listed Kite mutual funds by ISIN (INF174K01LS2), not by fund name.
const test = require('node:test');
const assert = require('node:assert');
const { tmpEnv, fixture, writeProfile, fakeBrokers, ctxAt } = require('./helpers');
const { callTool } = require('../core/tools');
const state = require('../core/lib/state');
const profiles = require('../core/lib/profile');
const snapshotLib = require('../core/lib/snapshot');

const ISIN = 'INF174K01LS2';
const NAME = 'Kotak Emerging Equity Fund';

async function refreshed() {
  const { folder } = tmpEnv();
  writeProfile(folder, fixture('profile.json'));
  const book = fixture('kite-book.json');
  book.mf[0].quantity = 5000; // big enough to make the top 10
  const ctx = ctxAt('2026-11-06T05:00:00Z', fakeBrokers({ kite: { data: book } }));
  const r = await callTool('refresh', { folder }, ctx);
  assert.ok(r.ok, r.text);
  return { folder, r };
}

test('Largest positions shows a Kite mutual fund by its name, not its ISIN', async () => {
  const { r } = await refreshed();
  const start = r.text.indexOf('**Largest positions**');
  assert.ok(start >= 0, 'no Largest positions section');
  const table = r.text.slice(start).split('\n\n')[0];
  assert.ok(table.includes(NAME), `fund name missing:\n${table}`);
  assert.ok(!table.includes(ISIN), `ISIN still shown:\n${table}`);
});

test('the position symbol stays the ISIN, so profile mappings and day-to-day diffs keep working', async () => {
  const { folder } = await refreshed();
  const c = snapshotLib.consolidate(state.latestSnapshot(folder), profiles.load(folder).profile);
  const fund = c.positions.find((p) => p.symbol === ISIN);
  assert.ok(fund, 'fund not keyed by ISIN');
  assert.strictEqual(fund.name, NAME);
  assert.strictEqual(c.positions.find((p) => p.symbol === 'SBIN').name, undefined);
});
