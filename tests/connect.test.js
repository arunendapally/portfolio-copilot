'use strict';
// Spec 002 US2 (T026): connect drives every broker to live or skipped, one round at a time.
const test = require('node:test');
const assert = require('node:assert');
const { tmpEnv, fixture, writeProfile } = require('./helpers');
const capture = require('../hooks/capture');
const { callTool } = require('../core/tools');

const NOW = '2026-11-16T05:00:00Z';
const ctx = (iso = NOW) => ({ edition: 'full', now: () => new Date(iso) });
const g2 = (name) => fixture(`kite-gen2/${name}`);
const hook = (tool_name, tool_input, payload, iso = NOW, isError = false) => capture.run({
  hook_event_name: isError ? 'PostToolUseFailure' : 'PostToolUse', tool_name, tool_input,
  ...(isError ? { error: payload } : { tool_response: JSON.stringify(payload) }),
}, new Date(iso));

const KITE = ['mcp__kite__session', 'mcp__kite__portfolio', 'mcp__kite__gtt', 'mcp__kite__orders', 'mcp__kite__mutual_funds', 'mcp__kite__market'];
const KOTAK = ['mcp__kotak__get_login', 'mcp__kotak__validate_login', 'mcp__kotak__get_holdings', 'mcp__kotak__get_limits'];

function setup(brokers = { kite: { enabled: true }, kotak: { enabled: true, ucc: 'UCC1' } }) {
  const { folder } = tmpEnv();
  writeProfile(folder, { schema_version: 2, brokers });
  return folder;
}

function kiteReads(iso = NOW) {
  hook('mcp__kite__portfolio', { mode: 'holdings', type: 'full', limit: 500 }, g2('holdings-full.json'), iso);
  hook('mcp__kite__gtt', { mode: 'list', limit: 500 }, g2('gtts.json'), iso);
  hook('mcp__kite__portfolio', { mode: 'margins' }, g2('margins.json'), iso);
}

test('Kite generation 2: session check first, then the full reads by their full names', async () => {
  const folder = setup({ kite: { enabled: true } });
  const a = await callTool('connect', { folder, tools: KITE }, ctx());
  assert.strictEqual(a.ready, false);
  assert.deepStrictEqual(a.next, [{ do: 'call', tool: 'mcp__kite__session', args: { mode: 'status' }, why: 'check whether Kite renews by itself' }]);
  hook('mcp__kite__session', { mode: 'status' }, g2('session-expired-refreshable.json'));
  const b = await callTool('connect', { folder, tools: KITE }, ctx());
  assert.deepStrictEqual(b.next.map((s) => [s.tool, s.args.mode]), [['mcp__kite__portfolio', 'holdings'], ['mcp__kite__gtt', 'list'], ['mcp__kite__portfolio', 'margins']]);
  assert.strictEqual(b.manual.length, 0, 'a refreshable session needs no login');
  kiteReads();
  const c = await callTool('connect', { folder, tools: KITE }, ctx());
  assert.strictEqual(c.ready, true);
  assert.strictEqual(c.brokers.kite.status, 'live');
  assert.match(c.text, /All connected/);
});

test('a login is asked only after a read failed with a login error, and all manual steps come at once', async () => {
  const folder = setup();
  hook('mcp__kite__session', { mode: 'status' }, { authenticated: false, kite_session_expired: true, refresh_available: false });
  hook('mcp__kotak__get_holdings', {}, 'Session expired, please login again', NOW, true);
  const r = await callTool('connect', { folder, tools: [...KITE, ...KOTAK] }, ctx());
  assert.strictEqual(r.ready, false);
  assert.strictEqual(r.brokers.kite.status, 'needs_login');
  assert.strictEqual(r.brokers.kotak.status, 'needs_login');
  assert.deepStrictEqual(r.manual.map((m) => m.broker), ['kite', 'kotak']);
  assert.deepStrictEqual(r.next, [{ do: 'call', tool: 'mcp__kotak__get_login', args: { ucc: 'UCC1' }, why: 'start the Kotak Neo QR login' }]);
  assert.match(r.text, /Needs you, all at once/);
});

test('Kotak with nothing read yet gets its reads, not a login', async () => {
  const folder = setup({ kite: { enabled: false }, kotak: { enabled: true, ucc: 'UCC1' } });
  const r = await callTool('connect', { folder, tools: KOTAK }, ctx());
  assert.deepStrictEqual(r.next.map((s) => s.tool), ['mcp__kotak__get_holdings', 'mcp__kotak__get_limits']);
  assert.deepStrictEqual(r.manual, []);
});

test('skip carries the broker with the age of its last data', async () => {
  const folder = setup();
  kiteReads('2026-11-16T04:50:00Z');
  hook('mcp__kotak__get_holdings', {}, 'x', '2026-11-15T05:00:00Z');
  const r = await callTool('connect', { folder, tools: [...KITE, ...KOTAK], skip: ['kotak'] }, ctx());
  assert.strictEqual(r.ready, true);
  assert.strictEqual(r.brokers.kotak.status, 'skipped');
  assert.match(r.text, /Connected: kite · skipped: kotak \(data from /);
});

test('unattended never asks for a login and is ready with each non-live broker skipped', async () => {
  const folder = setup();
  hook('mcp__kite__session', { mode: 'status' }, { kite_session_expired: true, refresh_available: false });
  hook('mcp__kotak__get_holdings', {}, 'Session expired, please login again', NOW, true);
  const r = await callTool('connect', { folder, tools: [...KITE, ...KOTAK], unattended: true }, ctx());
  assert.strictEqual(r.ready, true);
  assert.deepStrictEqual(r.manual, []);
  assert.ok(r.next.every((s) => !/login/.test(s.tool)));
  assert.strictEqual(r.brokers.kite.status, 'skipped');
  assert.strictEqual(r.brokers.kotak.status, 'skipped');
});

test('a broker whose MCP is not in the chat is not_connected, with one manual step', async () => {
  const folder = setup();
  kiteReads();
  const r = await callTool('connect', { folder, tools: KITE }, ctx());
  assert.strictEqual(r.brokers.kite.status, 'live');
  assert.strictEqual(r.brokers.kotak.status, 'not_connected');
  assert.match(r.manual[0].steps[0], /Connect the Kotak Neo MCP/);
});

test('an outage is reported and does not hold up ready', async () => {
  const folder = setup({ kite: { enabled: true } });
  hook('mcp__kite__session', { mode: 'status' }, g2('session-ok.json'));
  hook('mcp__kite__portfolio', { mode: 'holdings', type: 'full', limit: 500 }, 'upstream 502 bad gateway', NOW, true);
  hook('mcp__kite__gtt', { mode: 'list', limit: 500 }, g2('gtts.json'));
  hook('mcp__kite__portfolio', { mode: 'margins' }, g2('margins.json'));
  const r = await callTool('connect', { folder, tools: KITE }, ctx());
  assert.strictEqual(r.brokers.kite.status, 'outage');
  assert.strictEqual(r.ready, true);
  assert.match(r.text, /do not log in again/);
});

test('connect needs the tool names', async () => {
  const folder = setup();
  const r = await callTool('connect', { folder }, ctx());
  assert.strictEqual(r.ok, false);
});
