'use strict';
// US2: fast, consistent daily check.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { tmpEnv, fixture, writeProfile, fakeBrokers, ctxAt } = require('./helpers');
const { callTool } = require('../core/tools');
const kotak = require('../core/lib/brokers/kotak');

const KOTAK_TEXT = fs.readFileSync(path.join(__dirname, 'fixtures', 'kotak-holdings.txt'), 'utf8');

function setup({ kiteStatus, kotakStatus, book = fixture('kite-book.json'), kotakText = KOTAK_TEXT, kotakCash = -153.76 } = {}) {
  const { folder } = tmpEnv();
  const profile = fixture('profile.json');
  writeProfile(folder, profile);
  const brokers = fakeBrokers({
    kite: { status: kiteStatus, data: book },
    kotak: { status: kotakStatus, data: { holdings: kotak.holdingsFrom(kotakText, profile), cash: kotakCash } },
  });
  return { folder, brokers };
}

test('refresh consolidates kite equity, kite MF and kotak into one book', async () => {
  const { folder, brokers } = setup();
  const r = await callTool('refresh', { folder }, ctxAt('2026-10-14T05:00:00Z', brokers));
  assert.ok(r.ok, r.text);
  assert.deepStrictEqual(r.pulled, ['kite', 'kotak']);
  assert.strictEqual(r.brokers.kotak.count, 3);
  assert.ok(r.brokers.kite.count >= 10);
  assert.match(r.text, /base: all connected brokers/);
});

test('identical data gives identical output, 10 of 10', async () => {
  const { folder, brokers } = setup();
  const ctx = ctxAt('2026-10-14T05:00:00Z', brokers);
  await callTool('refresh', { folder }, ctx);
  const outs = new Set();
  for (let i = 0; i < 10; i++) outs.add((await callTool('check', { folder }, ctx)).text);
  assert.strictEqual(outs.size, 1);
});

test('a buy against a hold-no-add verdict is flagged unprompted', async () => {
  const { folder, brokers } = setup();
  const r = await callTool('refresh', { folder }, ctxAt('2026-10-14T05:00:00Z', brokers));
  const f = r.trade_audit.findings.find((x) => x.symbol === 'SBIFUNDS');
  assert.ok(f, 'SBIFUNDS contradiction missing');
  assert.strictEqual(f.level, 'critical');
  assert.match(r.text, /Needs attention[\s\S]*SBIFUNDS/);
});

test('small negative broker cash is treated as zero with a note', async () => {
  const { folder, brokers } = setup();
  const r = await callTool('refresh', { folder }, ctxAt('2026-10-14T05:00:00Z', brokers));
  assert.strictEqual(r.brokers.kotak.cash, 0);
  assert.match(r.text, /treated as 0/);
  assert.ok(!r.alerts.some((a) => /kotak cash is negative/.test(a.text)));
});

test('between-session changes are detected and explained', async () => {
  const { folder, brokers } = setup();
  await callTool('refresh', { folder }, ctxAt('2026-10-13T05:00:00Z', brokers));
  const next = fixture('kite-book.json');
  next.holdings = next.holdings.filter((h) => h.tradingsymbol !== 'TATAPOWER'); // GTT fired overnight
  next.gtts = next.gtts.filter((g) => g.id !== 6);
  next.holdings.push({ tradingsymbol: 'ONGC', exchange: 'NSE', quantity: 100, t1_quantity: 0, average_price: 240, last_price: 245 });
  next.orders = [];
  brokers.kite.fetchAll = async () => next;
  const r = await callTool('refresh', { folder }, ctxAt('2026-10-14T05:00:00Z', brokers));
  const tp = r.changes.changes.find((c) => c.symbol === 'TATAPOWER');
  const og = r.changes.changes.find((c) => c.symbol === 'ONGC');
  assert.strictEqual(tp.kind, 'exited');
  assert.match(tp.cause, /GTT fired/);
  assert.strictEqual(og.kind, 'new');
  assert.match(og.cause, /between sessions/);
});

test('fewer fund folios than last time is flagged, not concluded', async () => {
  const { folder, brokers } = setup();
  await callTool('refresh', { folder }, ctxAt('2026-10-13T05:00:00Z', brokers));
  const fewer = KOTAK_TEXT.split('\n').filter((l) => !l.includes('Nippon')).join('\n');
  brokers.kotak.fetchAll = async () => ({ holdings: kotak.holdingsFrom(fewer, fixture('profile.json')), cash: 0 });
  const r = await callTool('refresh', { folder }, ctxAt('2026-10-14T05:00:00Z', brokers));
  assert.strictEqual(r.changes.folio_drops.length, 1);
  assert.match(r.text, /not concluded/);
});

test('a broker that needs login is carried forward and counted as unverified', async () => {
  const { folder, brokers } = setup();
  await callTool('refresh', { folder }, ctxAt('2026-10-12T05:00:00Z', brokers));
  brokers.kite.status = async () => ({ status: 'needs_login' });
  await callTool('refresh', { folder }, ctxAt('2026-10-13T05:00:00Z', brokers));
  const r = await callTool('refresh', { folder }, ctxAt('2026-10-14T05:00:00Z', brokers));
  assert.match(r.text, /kite: needs login, showing data from 2026-10-12[^\n]*unverified 2 runs in a row/);
});

test('broker_status shows a link only for the broker that needs it', async () => {
  const { folder, brokers } = setup({ kotakStatus: { status: 'needs_login' } });
  const r = await callTool('broker_status', { folder }, ctxAt('2026-10-14T05:00:00Z', brokers));
  assert.strictEqual(r.brokers.kite.status, 'live');
  assert.ok(!r.brokers.kite.link);
  assert.ok(r.brokers.kotak.link);
  assert.doesNotMatch(r.text, /log in to Kite/);
});

test('outage tells the investor not to log in again', async () => {
  const { folder, brokers } = setup({ kiteStatus: { status: 'outage', detail: 'HTTP 502' } });
  const r = await callTool('broker_status', { folder }, ctxAt('2026-10-14T05:00:00Z', brokers));
  assert.match(r.text, /Do not log in again/);
  assert.doesNotMatch(r.text, /authorize/);
});

test('ingest adds a foreign broker with its FX rate and source', async () => {
  const { folder, brokers } = setup();
  const ctx = ctxAt('2026-10-14T05:00:00Z', brokers);
  await callTool('refresh', { folder }, ctx);
  const noFx = await callTool('ingest', { folder, broker: 'ibkr', currency: 'USD', holdings: [{ symbol: 'VOO', qty: 2, ltp: 500 }] }, ctx);
  assert.strictEqual(noFx.ok, false);
  const r = await callTool('ingest', { folder, broker: 'ibkr', currency: 'USD', fx_rate: 88, fx_source: 'RBI ref', cash: 30, holdings: [{ symbol: 'VOO', qty: 2, ltp: 500 }] }, ctx);
  assert.ok(r.ok);
  const c = await callTool('check', { folder }, ctx);
  assert.strictEqual(c.brokers.ibkr.value, 88000);
  assert.strictEqual(c.brokers.ibkr.cash, 2640);
  assert.match(c.text, /USD at 88 INR \(RBI ref/);
});

test('buffer held in the bank makes broker cash deployable', async () => {
  const { folder, brokers } = setup();
  const p = fixture('profile.json');
  p.cash = { buffer_min_pct: 50, buffer_max_pct: 60, buffer_location: 'bank' };
  writeProfile(folder, p);
  const r = await callTool('refresh', { folder }, ctxAt('2026-10-14T05:00:00Z', brokers));
  assert.strictEqual(r.cash.below_buffer, false);
  assert.match(r.text, /broker cash is deployable/);
});

test('allocation drift is measured against profile targets', async () => {
  const { folder, brokers } = setup();
  const p = fixture('profile.json');
  p.allocation = { targets: { india_equity: 55, gold: 8, debt: 5 }, symbol_buckets: { 'KOTAK ARBITRAGE FUND - DIRECT GROWTH': 'cash' } };
  writeProfile(folder, p);
  const r = await callTool('refresh', { folder }, ctxAt('2026-10-14T05:00:00Z', brokers));
  const gold = r.allocation.find((a) => a.bucket === 'gold');
  assert.ok(gold.value === 8000 && gold.target_pct === 8 && gold.drift_pp !== null);
  assert.ok(r.allocation.find((a) => a.bucket === 'debt').value === 0, 'arbitrage fund mapped to cash by profile');
  const sum = r.allocation.reduce((a, x) => a + x.pct_of_book, 0);
  assert.ok(Math.abs(sum - 100) < 0.1);
});

test('no data at all says so instead of showing a zero book', async () => {
  const { folder, brokers } = setup({ kiteStatus: { status: 'needs_login' }, kotakStatus: { status: 'needs_login' } });
  const r = await callTool('refresh', { folder }, ctxAt('2026-10-14T05:00:00Z', brokers));
  assert.ok(r.empty);
  assert.match(r.text, /No portfolio data yet/);
  assert.doesNotMatch(r.text, /Book ₹0/);
});

test('kotak unknown format fails loudly with the headers', () => {
  assert.throws(() => kotak.holdingsFrom('a,b,c\n1,2,3', {}), /Headers: a, b, c/);
});
