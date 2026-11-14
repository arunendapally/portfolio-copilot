'use strict';
// Spec 002, US1: broker reads are captured by capability, under both Kite tool generations
// (contracts/hooks.md, PostToolUse).
const test = require('node:test');
const assert = require('node:assert');
const { tmpEnv, fixture, writeProfile, runHook } = require('./helpers');
const session = require('../core/lib/session');
const capture = require('../hooks/capture');
const inputs = require('../core/lib/inputs');

const NOW = new Date('2026-11-16T05:00:00Z');
const g2 = (name) => fixture(`kite-gen2/${name}`);
const hook = (tool_name, tool_input, payload, now = NOW) => capture.run({ hook_event_name: 'PostToolUse', tool_name, tool_input, tool_response: JSON.stringify(payload) }, now);

test('generation 1 and generation 2 reads land in the same capability file', () => {
  tmpEnv();
  assert.deepStrictEqual(hook('mcp__kite__get_gtts', {}, []), { source: 'kite', cap: 'gtts', tool: 'get_gtts', ok: true });
  assert.deepStrictEqual(hook('mcp__kite__gtt', { mode: 'list', limit: 500 }, g2('gtts.json')), { source: 'kite', cap: 'gtts', tool: 'gtt', ok: true });
  const r = session.read('kite', 'gtts');
  assert.strictEqual(r.tool, 'mcp__kite__gtt');
  assert.strictEqual(r.mode, 'list');
  assert.strictEqual(r.partial, false);
});

test('writes, session calls and market lookups are not captured', () => {
  tmpEnv();
  assert.strictEqual(hook('mcp__kite__gtt', { mode: 'place' }, { ok: true }), null);
  assert.strictEqual(hook('mcp__kite__session', { mode: 'status' }, g2('session-ok.json')), null);
  assert.strictEqual(hook('mcp__kite__market', { mode: 'search', query: 'x' }, { data: [] }), null);
  assert.strictEqual(hook('mcp__kite__orders', { mode: 'place' }, g2('orders-approval-required.json')), null);
  assert.strictEqual(hook('mcp__claude_ai_Gmail__list_drafts', {}, []), null);
});

test('compact or summary holdings are not captured as holdings', () => {
  tmpEnv();
  assert.strictEqual(hook('mcp__kite__portfolio', { mode: 'holdings', type: 'compact' }, g2('holdings-compact.json')), null);
  assert.strictEqual(hook('mcp__kite__portfolio', { mode: 'holdings', type: 'summary' }, {}), null);
  assert.strictEqual(session.read('kite', 'holdings'), null);
  assert.strictEqual(hook('mcp__kite__portfolio', { mode: 'holdings', type: 'full' }, g2('holdings-full.json')).cap, 'holdings');
  assert.strictEqual(hook('mcp__kite__portfolio', { mode: 'holdings' }, g2('holdings-full.json')).cap, 'holdings', 'type defaults to full');
});

test('a partial page is marked from the pagination the broker returned', () => {
  tmpEnv();
  hook('mcp__kite__gtt', { mode: 'list', limit: 2 }, g2('gtts-page1.json'));
  const r = session.read('kite', 'gtts');
  assert.strictEqual(r.partial, true);
  assert.match(r.paged, /more rows/);
  hook('mcp__kite__gtt', { mode: 'list', from: 2, limit: 500 }, { data: [], pagination: { from: 2, limit: 500, total: 3, has_more: false, returned: 1 } });
  assert.strictEqual(session.read('kite', 'gtts').partial, true, 'an offset read is partial');
  hook('mcp__kite__gtt', { mode: 'list', limit: 500 }, g2('gtts.json'));
  assert.strictEqual(session.read('kite', 'gtts').partial, false, 'an explicit limit with has_more false is complete');
});

test('without pagination in the payload, a limit or offset in the call still marks it partial', () => {
  tmpEnv();
  hook('mcp__kite__get_gtts', { limit: 10 }, []);
  assert.strictEqual(session.read('kite', 'gtts').partial, true);
});

test('"unknown tool" from a renamed broker tool is captured as tools_changed', () => {
  tmpEnv();
  capture.run({ hook_event_name: 'PostToolUseFailure', tool_name: 'mcp__kite__get_holdings', tool_input: {}, error: 'Error: unknown tool "get_holdings"' }, NOW);
  const r = session.read('kite', 'holdings');
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.tools_changed, true);
  assert.strictEqual(r.login, false);
});

test('price reads merge across calls, under either generation', () => {
  tmpEnv();
  hook('mcp__kite__market', { mode: 'ltp', instruments: ['NSE:NIFTY 50'] }, { data: { 'NSE:NIFTY 50': { last_price: 24000 } }, meta: {} });
  hook('mcp__kite__get_ltp', {}, { 'NSE:ALPHA': { last_price: 560 } });
  assert.deepStrictEqual(inputs.ltp(), { 'NSE:NIFTY 50': 24000, 'NSE:ALPHA': 560 });
});

test('a full generation-2 Kite read set makes Kite live with the same holdings as generation 1', () => {
  const { folder } = tmpEnv();
  writeProfile(folder, fixture('profile.json'));
  hook('mcp__kite__portfolio', { mode: 'holdings', type: 'full', limit: 500 }, g2('holdings-full.json'));
  hook('mcp__kite__gtt', { mode: 'list', limit: 500 }, g2('gtts.json'));
  hook('mcp__kite__portfolio', { mode: 'margins' }, g2('margins.json'));
  hook('mcp__kite__mutual_funds', { mode: 'holdings' }, g2('mf.json'));
  const r = inputs.pull('kite', require('../core/lib/profile').load(folder).profile, NOW);
  assert.strictEqual(r.status, 'live', r.detail);
  assert.deepStrictEqual(r.block.holdings.filter((h) => h.type !== 'mf').map((h) => h.symbol).sort(), ['ALPHA', 'BETA', 'GAMMAETF']);
  assert.strictEqual(r.block.gtts.length, 3);
  assert.strictEqual(r.block.cash, 25000);
  assert.strictEqual(r.block.holdings.find((h) => h.type === 'mf').name, 'EXAMPLE FLEXI CAP FUND - DIRECT PLAN');
});

test('a missing tool shows as tools_changed, never as an outage or a login', () => {
  const { folder } = tmpEnv();
  writeProfile(folder, fixture('profile.json'));
  for (const t of ['get_holdings', 'get_gtts', 'get_margins']) capture.run({ hook_event_name: 'PostToolUseFailure', tool_name: `mcp__kite__${t}`, tool_input: {}, error: `unknown tool "${t}"` }, NOW);
  const r = inputs.pull('kite', require('../core/lib/profile').load(folder).profile, NOW);
  assert.strictEqual(r.status, 'tools_changed');
  assert.match(r.detail, /doctor/);
  assert.doesNotMatch(r.detail, /log in|outage/i);
});

test('the hook process captures through stdin', () => {
  tmpEnv();
  runHook('capture.js', { hook_event_name: 'PostToolUse', tool_name: 'mcp__kite__portfolio', tool_input: { mode: 'margins' }, tool_response: JSON.stringify(g2('margins.json')) });
  assert.ok(session.read('kite', 'margins'));
});

test('Kotak cash is read from the limits CSV the broker returns', () => {
  const { folder } = tmpEnv();
  writeProfile(folder, { ...fixture('profile.json'), brokers: { kite: { enabled: false }, kotak: { enabled: true, ucc: 'X0000' }, ibkr: { enabled: false } } });
  session.record('mcp__kotak-neo__get_holdings', fixture('kotak-holdings-neo-2026-10.txt'), NOW);
  session.record('mcp__kotak-neo__get_limits', require('fs').readFileSync(require('path').join(__dirname, 'fixtures', 'kotak-limits.txt'), 'utf8'), NOW);
  const r = inputs.pull('kotak', require('../core/lib/profile').load(folder).profile, NOW);
  assert.strictEqual(r.status, 'live', r.detail);
  assert.strictEqual(r.block.cash, 1234.5);
});

test('Kotak cash that cannot be read is unknown and keeps Kotak from being live', () => {
  const { folder } = tmpEnv();
  writeProfile(folder, { ...fixture('profile.json'), brokers: { kite: { enabled: false }, kotak: { enabled: true, ucc: 'X0000' }, ibkr: { enabled: false } } });
  session.record('mcp__kotak-neo__get_holdings', fixture('kotak-holdings-neo-2026-10.txt'), NOW);
  session.record('mcp__kotak-neo__get_limits', 'Something we have never seen', NOW);
  const r = inputs.pull('kotak', require('../core/lib/profile').load(folder).profile, NOW);
  assert.strictEqual(r.status, 'format_error');
  assert.match(r.detail, /cash/i);
});
