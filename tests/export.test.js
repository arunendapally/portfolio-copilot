'use strict';
// Spec 002 T083: dashboard files from the latest snapshot; missing technicals are null.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { tmpEnv, fixture, writeProfile, fakeBrokers, ctxAt } = require('./helpers');
const { callTool } = require('../core/tools');
const exportLib = require('../core/lib/export');

const FIELDS = ['key', 'broker', 'sym', 'name', 'type', 'kind', 'bucket', 'core', 'qty', 'avg', 'ltp', 'prevClose', 'fx', 'gttQty', 'gttStop', 'gttTarget', 'settling', 'dma50', 'dma200', 'rsi', 'sup20', 'hi52', 'asof'];

test('export writes positions and cash in the dashboard shape, technicals null when not computed', async () => {
  const { root, folder } = tmpEnv();
  writeProfile(folder, { ...fixture('profile.json'), brokers: { kite: { enabled: true }, kotak: { enabled: false } } });
  const ctx = ctxAt('2026-10-14T05:00:00Z', fakeBrokers({ kite: { data: fixture('kite-book.json') } }));
  await callTool('refresh', { folder }, ctx);
  const out = path.join(root, 'dash');
  const r = await callTool('export', { folder, format: 'dashboard', out }, ctx);
  assert.ok(r.ok, r.text);
  const pos = JSON.parse(fs.readFileSync(path.join(out, 'positions-2026-10-14.json'), 'utf8'));
  assert.ok(pos.length > 0);
  for (const f of FIELDS) assert.ok(f in pos[0], `missing ${f}`);
  assert.ok(pos.every((p) => exportLib.TECH.every((k) => p[k] === null)));
  const icici = pos.find((p) => p.sym === 'ICICIBANK');
  assert.strictEqual(icici.gttQty, 46);
  assert.strictEqual(icici.gttStop, 900);
  const cash = JSON.parse(fs.readFileSync(path.join(out, 'cash-2026-10-14.json'), 'utf8'));
  assert.strictEqual(cash.cash[0].broker, 'kite');
});

test('a technical the snapshot carries is passed through with its value', () => {
  const P = require('../core/lib/profile');
  const snap = { taken_at: '2026-10-14T05:00:00Z', fx: {}, technicals: { A: { dma50: 101.5, rsi: 44 } }, brokers: { kotak: { as_of: '2026-10-14T05:00:00Z', holdings: [{ symbol: 'A', type: 'equity', qty: 1, ltp: 100, value: 100, currency: 'INR' }], cash: 0 } } };
  const r = exportLib.rows(snap, null, P.merge(P.DEFAULTS, {}), null);
  assert.strictEqual(r.positions[0].dma50, 101.5);
  assert.strictEqual(r.positions[0].dma200, null);
});
