'use strict';
// Issue #23: broker reads are captured from the brokers' own MCP tools and the pc script
// computes from them; no server, no broker login of our own.
const test = require('node:test');
const assert = require('node:assert');
const { tmpEnv, fixture, writeProfile } = require('./helpers');
const capture = require('../hooks/capture');
const session = require('../core/lib/session');
const inputs = require('../core/lib/inputs');
const pc = require('../core/bin/pc');
const drafts = require('../core/lib/drafts');
const gate = require('../hooks/order-gate');
const approve = require('../hooks/approve');

const NOW = new Date('2026-10-29T05:00:00Z');

// What Claude Code hands the hook after the Kite MCP answers.
function hook(tool, payload, extra = {}) {
  return capture.run({ tool_name: tool, tool_response: { content: [{ type: 'text', text: typeof payload === 'string' ? payload : JSON.stringify(payload) }], ...extra } }, NOW);
}

function captureKite(book = fixture('kite-book.json'), prefix = 'mcp__kite__') {
  hook(`${prefix}get_holdings`, book.holdings);
  hook(`${prefix}get_mf_holdings`, book.mf);
  hook(`${prefix}get_gtts`, book.gtts);
  hook(`${prefix}get_margins`, book.margins);
  hook(`${prefix}get_orders`, book.orders);
}

async function run(args) {
  let out = '';
  const code = await pc.main(args, (s) => { out += s; });
  return { code, out };
}

test('the capture hook saves broker reads on any prefix and ignores everything else', () => {
  tmpEnv();
  assert.deepStrictEqual(hook('mcp__kite__get_gtts', []), { source: 'kite', suffix: 'get_gtts', ok: true });
  assert.strictEqual(hook('mcp__remote-devices__kite__get_holdings', []).source, 'kite');
  assert.strictEqual(hook('mcp__claude_ai_Interactive_Brokers_IBKR__get_account_positions', []).source, 'ibkr');
  assert.strictEqual(hook('mcp__claude_ai_Gmail__list_drafts', []), null);
  assert.strictEqual(capture.run({ tool_name: 'mcp__kite__place_order', tool_response: 'x' }, NOW), null);
  assert.strictEqual(capture.run({ tool_name: 'Bash', tool_response: 'x' }, NOW), null);
});

test('tool results arrive as text, content blocks or {content}: all are read', () => {
  assert.strictEqual(session.textOf('{"a":1}'), '{"a":1}');
  assert.strictEqual(session.textOf([{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }]), 'a\nb');
  assert.strictEqual(session.textOf({ content: [{ type: 'text', text: 'c' }] }), 'c');
});

test('pc refresh and gtt_audit compute from captured reads, with no broker object at all', async () => {
  const { folder } = tmpEnv();
  writeProfile(folder, fixture('profile.json'));
  captureKite();
  const now = new Date();
  session.record('mcp__kite__get_holdings', JSON.stringify(fixture('kite-book.json').holdings), now); // fresh for the 30 min rule
  for (const [t, k] of [['get_mf_holdings', 'mf'], ['get_gtts', 'gtts'], ['get_margins', 'margins'], ['get_orders', 'orders']]) session.record(`mcp__kite__${t}`, JSON.stringify(fixture('kite-book.json')[k]), now);
  const r = await run(['refresh', '--folder', folder]);
  assert.strictEqual(r.code, 0, r.out);
  assert.match(r.out, /kite: live, data/);
  const a = await run(['gtt_audit', '--folder', folder]);
  assert.match(a.out, /GTT audit/);
  assert.match(a.out, /Crash test/);
});

test('an expired Kite session is captured as a login request, then a good read clears it', () => {
  const { folder } = tmpEnv();
  writeProfile(folder, fixture('profile.json'));
  hook('mcp__kite__get_holdings', 'Invalid session: please log in', { isError: true });
  hook('mcp__kite__get_gtts', []);
  hook('mcp__kite__get_margins', {});
  const profile = fixture('profile.json');
  assert.strictEqual(inputs.pull('kite', profile, NOW).status, 'needs_login');
  assert.match(inputs.pull('kite', profile, NOW).detail, /Kite MCP login tool/);
  captureKite();
  assert.strictEqual(inputs.pull('kite', profile, NOW).status, 'live');
});

test('prices asked for in pieces are merged, not overwritten', () => {
  tmpEnv();
  hook('mcp__kite__get_ltp', { 'NSE:NIFTY 50': { last_price: 22800 } });
  hook('mcp__kite__get_ltp', { 'NSE:SBIN': { last_price: 800 } });
  assert.deepStrictEqual(inputs.ltp(), { 'NSE:NIFTY 50': 22800, 'NSE:SBIN': 800 });
});

test('pc parses flags and --json, and reports unknown commands', async () => {
  assert.deepStrictEqual(pc.parse(['draft_gtt_plan', '--folder', 'C:/x', '--json', '{"symbols":["TMCV"]}']), { command: 'draft_gtt_plan', args: { folder: 'C:/x', symbols: ['TMCV'] } });
  assert.deepStrictEqual(pc.parse(['broker_status', '--hook_version', '0.7.0']).args, { hook_version: '0.7.0' });
  const r = await run(['nope']);
  assert.strictEqual(r.code, 1);
  assert.match(r.out, /Unknown tool/);
});

test('change-a-stop flow end to end: read, audit, plan, click, gate allows each row once, re-read, one GTT per holding', async () => {
  const { folder } = tmpEnv();
  writeProfile(folder, fixture('profile.json'));
  const book = fixture('kite-book.json');
  const fresh = (b) => {
    const now = new Date();
    for (const [t, k] of [['get_holdings', 'holdings'], ['get_mf_holdings', 'mf'], ['get_gtts', 'gtts'], ['get_margins', 'margins'], ['get_orders', 'orders']]) session.record(`mcp__kite__${t}`, JSON.stringify(b[k]), now);
  };
  fresh(book);
  await run(['refresh', '--folder', folder]);
  const plan = await run(['draft_gtt_plan', '--folder', folder, '--json', '{"symbols":["LUPIN"]}']);
  const code = plan.out.match(/GTT plan (D[A-Z0-9]{4})/)[1];
  assert.match(plan.out, /delete_gtt_order \{"trigger_id":8\}/);
  const draft = drafts.load(folder, code);
  const q = { header: code, question: `Place GTT plan ${code}?`, multiSelect: false, options: [{ label: "No, don't place" }, { label: `Yes, place ${code}` }] };
  const gateAsk = gate.decide({ tool_name: 'AskUserQuestion', tool_input: { questions: [q] } }, [folder], NOW);
  assert.strictEqual(gateAsk.allow, true);
  const del = { tool_name: 'mcp__kite__delete_gtt_order', tool_input: { trigger_id: 8 } };
  assert.strictEqual(gate.decide(del, [folder], new Date()).allow, false, 'blocked before the click');
  approve.run({ tool_name: 'AskUserQuestion', cwd: folder, tool_input: { questions: [q] }, tool_response: { questions: [q], answers: { [q.question]: `Yes, place ${code}` } } }, new Date());
  assert.ok(draft.rows.some((r) => r.tool === 'delete_gtt_order' && r.args.trigger_id === 8));
  assert.strictEqual(gate.decide(del, [folder], new Date()).allow, true);
  assert.strictEqual(gate.decide(del, [folder], new Date()).allow, false, 'once per row');
  // Re-read after the delete: LUPIN is back to one GTT at the held quantity.
  book.gtts = book.gtts.filter((g) => g.id !== 8);
  fresh(book);
  await run(['refresh', '--folder', folder]);
  const after = await run(['gtt_audit', '--folder', folder]);
  assert.doesNotMatch(after.out, /LUPIN[^\n]*GTTs cover/);
});
