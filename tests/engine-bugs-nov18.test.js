'use strict';
// Bug engine-bugs-nov18: three engine bugs from daily use on 18 and 19 Nov 2026.
const test = require('node:test');
const assert = require('node:assert');
const { tmpEnv, fixture, writeProfile, ctxAt } = require('./helpers');
const { callTool } = require('../core/tools');
const state = require('../core/lib/state');
const exportLib = require('../core/lib/export');
const norm = require('../core/lib/brokers/normalize');
const P = require('../core/lib/profile');

const GROUPED = ['mcp__kite__session', 'mcp__kite__portfolio', 'mcp__kite__gtt', 'mcp__kite__market', 'mcp__kite__orders'];

test('broker_status with the grouped Kite tools and nothing captured yet asks for the session check, not "not connected"', async () => {
  const { folder } = tmpEnv();
  writeProfile(folder, { ...fixture('profile.json'), brokers: { kite: { enabled: true }, kotak: { enabled: false } } });
  const r = await callTool('broker_status', { folder, tools: GROUPED }, ctxAt('2026-11-18T10:00:00Z'));
  assert.notStrictEqual(r.brokers.kite.status, 'not_connected', r.text);
  assert.deepStrictEqual(r.next[0], { do: 'call', tool: 'mcp__kite__session', args: { mode: 'status' }, why: 'check whether Kite renews by itself' });
});

const IBKR = { broker: 'ibkr', currency: 'USD', fx_rate: 90, fx_source: 'test rate' };

test('ingest takes IBKR rows under positions, the name of the IBKR read', async () => {
  const { folder } = tmpEnv();
  writeProfile(folder, fixture('profile.json'));
  const r = await callTool('ingest', { folder, ...IBKR, cash: 34.62, positions: [{ contract_description: 'VOO', position: 2, market_price: 600, avg_cost: 550 }] }, ctxAt('2026-11-19T04:00:00Z'));
  assert.ok(r.ok, r.text);
  assert.strictEqual(r.holdings, 1);
  const b = state.latestSnapshot(folder).brokers.ibkr;
  assert.strictEqual(b.holdings[0].symbol, 'VOO');
  assert.strictEqual(b.cash, 34.62);
});

test('ingest refuses rows under a key it does not know instead of ingesting 0 silently', async () => {
  const { folder } = tmpEnv();
  writeProfile(folder, fixture('profile.json'));
  const r = await callTool('ingest', { folder, ...IBKR, cash: 1, rows: [{ symbol: 'VOO', qty: 1, ltp: 600 }] }, ctxAt('2026-11-19T04:00:00Z'));
  assert.strictEqual(r.ok, false, r.text);
  assert.match(r.text, /holdings|positions/);
  assert.strictEqual(state.latestSnapshot(folder), null);
});

test('ingest refuses IBKR cash it cannot read as a number instead of saving null', async () => {
  const { folder } = tmpEnv();
  writeProfile(folder, fixture('profile.json'));
  const r = await callTool('ingest', { folder, ...IBKR, cash: { USD: 34.62 }, holdings: [{ symbol: 'VOO', qty: 1, ltp: 600 }] }, ctxAt('2026-11-19T04:00:00Z'));
  assert.strictEqual(r.ok, false, r.text);
  assert.match(r.text, /cash/);
});

test('export writes broker, type, kind and bucket as the dashboard labels them, and asof as IST text', () => {
  const snap = { taken_at: '2026-11-19T09:06:00Z', fx: { USD: { rate: 93.92 } }, brokers: {
    kite: { as_of: '2026-11-19T09:06:00Z', cash: 0, holdings: [
      { symbol: 'BANKBARODA', type: 'equity', qty: 1, ltp: 280, value: 280, currency: 'INR' },
      { symbol: 'GOLDBEES', type: 'etf', qty: 1, ltp: 100, value: 100, currency: 'INR' },
      { symbol: 'INF000X', name: 'SBI Gold Fund', type: 'mf', qty: 1, ltp: 40, value: 40, currency: 'INR' }] },
    kotak: { as_of: '2026-11-19T09:02:00Z', cash: 0, holdings: [{ symbol: 'KWIL', type: 'equity', qty: 1, ltp: 41, value: 41, currency: 'INR' }] },
    ibkr: { as_of: '2026-11-19T04:00:00Z', cash: 0, holdings: [{ symbol: 'QQQM', type: 'etf', qty: 1, ltp: 270, value: 270, currency: 'USD' }] },
  } };
  const r = exportLib.rows(snap, null, P.merge(P.DEFAULTS, {}), null);
  const by = Object.fromEntries(r.positions.map((p) => [p.sym, p]));
  assert.deepStrictEqual([by.BANKBARODA.broker, by.BANKBARODA.type, by.BANKBARODA.kind, by.BANKBARODA.bucket], ['Kite', 'Equity', 'Stock', 'India equity']);
  assert.deepStrictEqual([by.GOLDBEES.kind, by.GOLDBEES.bucket], ['ETF', 'Gold']);
  assert.deepStrictEqual([by.INF000X.type, by.INF000X.kind], ['Mutual fund', 'Fund']);
  assert.deepStrictEqual([by.KWIL.broker, by.QQQM.broker, by.QQQM.bucket], ['Kotak Neo', 'IBKR', 'Global']);
  assert.strictEqual(by.QQQM.key, 'ibkr:QQQM');
  assert.strictEqual(by.BANKBARODA.asof, '2026-11-19 14:36 IST');
  assert.strictEqual(r.cash.find((c) => c.broker === 'Kite').asof, '2026-11-19 14:36 IST');
});

test('export prevClose for a Kite stock is Kite close_price, not the last snapshot price', () => {
  const book = fixture('kite-gen2/holdings-full.json');
  const holdings = norm.kiteHoldings(book, P.merge(P.DEFAULTS, {}));
  const alpha = book.data.find((h) => h.tradingsymbol === 'ALPHA');
  const snap = { taken_at: '2026-11-19T09:06:00Z', fx: {}, brokers: { kite: { as_of: '2026-11-19T09:06:00Z', cash: 0, holdings } } };
  const prev = { taken_at: '2026-11-17T05:00:00Z', brokers: { kite: { holdings: [{ symbol: 'ALPHA', ltp: 1 }] } } };
  const r = exportLib.rows(snap, prev, P.merge(P.DEFAULTS, {}), null);
  assert.strictEqual(r.positions.find((p) => p.sym === 'ALPHA').prevClose, alpha.close_price);
});

test('a Kite close_price of 0 (no close yet) is no previous close, not a price of 0', () => {
  const [h] = norm.kiteHoldings({ data: [{ tradingsymbol: 'NEWLIST', quantity: 1, last_price: 100, average_price: 90, close_price: 0 }] }, P.merge(P.DEFAULTS, {}));
  assert.strictEqual(h.prev_close, null);
});
