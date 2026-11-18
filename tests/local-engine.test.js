'use strict';
// Spec 002 US7 (T085): the local engine, per contracts/local-engine.md. No network: collectors
// get a fake fetch, and the fake collector writes fixture captures.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { tmpEnv, fixture, writeProfile, fakeBrokers, ctxAt } = require('./helpers');
const { callTool } = require('../core/tools');
const state = require('../core/lib/state');
const { makeServer, MAX_TEXT } = require('../local/server');
const fake = require('../local/collectors/fake');
const kite = require('../local/collectors/kite');
const ibkr = require('../local/collectors/ibkr');
const collectors = require('../local/collectors');
const toolmap = require('../core/lib/brokers/toolmap');

const NOW = new Date('2026-11-16T05:00:00Z');
const ctx = { edition: 'full', now: () => NOW, github: {} };
const book = () => fixture('kite-book.json');
const kiteData = (b = book()) => ({ holdings: b.holdings, gtts: b.gtts, margins: b.margins, mf: b.mf || [], orders: b.orders || [] });
const deps = (data, st = 'ready') => ({ collectors: { kite: fake({ broker: 'kite', data, state: st, now: () => NOW }), kotak: require('../local/collectors/kotak')(), ibkr: fake({ broker: 'ibkr', data: {}, state: 'needs_login' }) } });

function setup() {
  const { root, folder } = tmpEnv();
  writeProfile(folder, { ...fixture('profile.json'), brokers: { kite: { enabled: true }, kotak: { enabled: false } } });
  return { root, folder };
}

test('a fake collector writing fixture captures leads to the same snapshot as the hook path', async () => {
  const a = setup();
  await callTool('refresh', { folder: a.folder }, ctxAt(NOW.toISOString(), fakeBrokers({ kite: { data: book() } })));
  const viaHook = state.latestSnapshot(a.folder).brokers.kite;
  const b = setup();
  const server = makeServer({ folder: b.folder, deps: deps(kiteData()), ctx });
  await server.call('portfolio_refresh', {});
  const viaLocal = state.latestSnapshot(b.folder).brokers.kite;
  assert.strictEqual(viaLocal.status, 'live');
  assert.deepStrictEqual(viaLocal.holdings, viaHook.holdings);
  assert.deepStrictEqual(viaLocal.gtts, viaHook.gtts);
  assert.strictEqual(viaLocal.cash, viaHook.cash);
});

test('no local tool result exceeds 2 KB on a 100-holding book', async () => {
  const { folder } = setup();
  const b = book();
  b.holdings = Array.from({ length: 100 }, (_, i) => ({ ...b.holdings[i % b.holdings.length], tradingsymbol: `SYM${i}`, isin: `INE${String(i).padStart(9, '0')}` }));
  const server = makeServer({ folder, deps: deps(kiteData(b)), ctx });
  const results = [
    await server.call('portfolio_refresh', {}),
    await server.call('portfolio_status', {}),
    await server.call('portfolio_query', { q: 'allocation' }),
    await server.call('portfolio_query', { q: 'guardrails' }),
    await server.call('portfolio_query', { q: 'decisions' }),
    await server.call('portfolio_review', { action: 'start', tools: ['mcp__kite__get_holdings', 'mcp__kite__get_gtts', 'mcp__kite__get_margins'] }),
  ];
  for (const r of results) assert.ok(Buffer.byteLength(r.content[0].text) <= MAX_TEXT, `${Buffer.byteLength(r.content[0].text)} bytes: ${r.content[0].text.slice(0, 80)}`);
});

test('no broker tool, and no write, can be called through the local server', async () => {
  const { folder } = setup();
  const server = makeServer({ folder, deps: deps(kiteData()), ctx });
  assert.deepStrictEqual(server.TOOLS.map((t) => t.name), ['portfolio_status', 'portfolio_refresh', 'portfolio_review', 'portfolio_query']);
  const writes = toolmap.ROWS.filter((r) => r.kind === 'write').map((r) => r.tool);
  for (const w of [...new Set(writes)]) {
    const r = await server.call(w, { mode: 'place' });
    assert.strictEqual(r.isError, true, w);
  }
  const res = await server.handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
  assert.strictEqual(res.result.tools.length, 4);
});

test('the review runs through the server: broker reads are done by the engine, only your steps come back', async () => {
  const { folder } = setup();
  const server = makeServer({ folder, deps: deps(kiteData()), ctx });
  const r = await server.call('portfolio_review', { action: 'start', tools: ['mcp__kite__get_holdings', 'mcp__kite__get_gtts', 'mcp__kite__get_margins', 'mcp__kite__place_gtt_order'] });
  const s = r.structuredContent;
  assert.strictEqual(s.stage, 'research', r.content[0].text);
  assert.ok(s.next.every((x) => x.do !== 'call'), 'no broker read is left for the model');
});

test('a collector without secrets reports needs_login and writes nothing', async () => {
  setup();
  const k = kite({ fetch: async () => { throw new Error('no network in tests'); }, now: () => NOW });
  const st = await k.status();
  assert.strictEqual(st.state, 'needs_login');
  const p = await k.pull();
  assert.deepStrictEqual(p.written, []);
  assert.ok(!fs.existsSync(path.join(state.configDir(), 'captured', 'kite')));
  const i = ibkr({ fetch: async () => { throw new Error('no network'); } });
  assert.strictEqual((await i.status()).state, 'needs_login');
});

test('Kite: the daily login exchange, then reads by GET only, stored as captures', async () => {
  setup();
  collectors.writeSecrets('kite', { api_key: 'key1', api_secret: 'sec1' });
  const calls = [];
  const b = book();
  const fetchImpl = async (url, init) => {
    calls.push([init.method, url]);
    if (url.endsWith('/session/token')) {
      const body = new URLSearchParams(init.body);
      assert.strictEqual(body.get('checksum'), crypto.createHash('sha256').update('key1' + 'rt9' + 'sec1').digest('hex'));
      return { ok: true, status: 200, text: async () => JSON.stringify({ status: 'success', data: { access_token: 'acc' } }) };
    }
    assert.strictEqual(init.headers.Authorization, 'token key1:acc');
    const data = url.endsWith('/portfolio/holdings') ? b.holdings : url.endsWith('/gtt/triggers') ? b.gtts : url.endsWith('/user/margins') ? b.margins : [];
    return { ok: true, status: 200, text: async () => JSON.stringify({ status: 'success', data }) };
  };
  const k = kite({ fetch: fetchImpl, now: () => NOW });
  assert.match((await k.status()).login.url, /^https:\/\/kite\.zerodha\.com\/connect\/login\?v=3&api_key=key1$/);
  assert.strictEqual((await k.login({ request_token: 'rt9' })).state, 'ready');
  const p = await k.pull(['holdings', 'gtts', 'margins']);
  assert.deepStrictEqual(p.written, ['holdings', 'gtts', 'margins']);
  assert.deepStrictEqual(calls.map(([m]) => m), ['POST', 'GET', 'GET', 'GET'], 'the only POST is the session exchange');
  const rec = JSON.parse(fs.readFileSync(path.join(state.configDir(), 'captured', 'kite', 'holdings.json'), 'utf8'));
  assert.strictEqual(rec.tool, 'local:kite:/portfolio/holdings');
  // The next trading day the token has expired: a new login is due.
  const tomorrow = kite({ fetch: fetchImpl, now: () => new Date('2026-11-17T05:00:00Z') });
  assert.strictEqual((await tomorrow.status()).state, 'needs_login');
});

test('IBKR Flex: request, then statement; positions, cash and the INR rate', async () => {
  setup();
  collectors.writeSecrets('ibkr', { token: 'tok', query_id: '123' });
  const xml = '<FlexQueryResponse><FlexStatements><FlexStatement><OpenPositions><OpenPosition symbol="VOO" assetCategory="STK" currency="USD" position="1.2584" markPrice="677.06" positionValue="852.01" costBasisPrice="686.56" fifoPnlUnrealized="-11.95" levelOfDetail="SUMMARY" reportDate="2026-11-14"/></OpenPositions><CashReport><CashReportCurrency currency="USD" endingCash="34.62" toDate="2026-11-14"/></CashReport><ConversionRates><ConversionRate fromCurrency="USD" toCurrency="INR" rate="88.5" reportDate="2026-11-14"/></ConversionRates></FlexStatement></FlexStatements></FlexQueryResponse>';
  let n = 0;
  const fetchImpl = async (url, init) => {
    assert.strictEqual(init.method, 'GET');
    if (url.includes('/SendRequest')) return { ok: true, status: 200, text: async () => '<FlexStatementResponse><Status>Success</Status><ReferenceCode>REF1</ReferenceCode></FlexStatementResponse>' };
    n++;
    return { ok: true, status: 200, text: async () => (n === 1 ? '<FlexStatementResponse><Status>Warn</Status><ErrorCode>1019</ErrorCode></FlexStatementResponse>' : xml) };
  };
  const r = await ibkr({ fetch: fetchImpl, wait: async () => {}, now: () => NOW }).pull();
  assert.deepStrictEqual(r.written, ['holdings', 'balances']);
  assert.deepStrictEqual(r.parsed.positions.map((p) => [p.symbol, p.qty]), [['VOO', 1.2584]]);
  assert.deepStrictEqual(r.parsed.rates, [{ from: 'USD', rate: 88.5, date: '2026-11-14' }]);
  assert.strictEqual(n, 2, 'it waited for the statement once');
});

test('the lite build contains no local/ files; the full build carries the local engine', () => {
  const build = require('../scripts/build');
  assert.ok(![...build.liteFiles().keys()].some((f) => f.startsWith('local/')));
  assert.ok([...build.fullFiles().keys()].includes('local/server.js'));
});

test('technicals appear only once there are enough closes, dated', () => {
  const t = require('../core/lib/technicals');
  const series = Array.from({ length: 60 }, (_, i) => ({ date: `2026-0${1 + Math.floor(i / 28)}-${String((i % 28) + 1).padStart(2, '0')}`, close: 100 + i }));
  const r = t.compute(series);
  assert.strictEqual(r.dma50, 134.5);
  assert.strictEqual(r.dma200, null);
  assert.strictEqual(r.rsi, 100);
  assert.strictEqual(r.sup20, 140);
  assert.strictEqual(r.hi52, null);
  assert.strictEqual(r.as_of, series[59].date);
  assert.deepStrictEqual(t.compute(series.slice(0, 5)).dma50, null);
});
