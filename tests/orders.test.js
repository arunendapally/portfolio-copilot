'use strict';
// US4: orders only from drafts the investor approved. Deterministic, fail closed.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { tmpEnv, fixture, writeProfile, fakeBrokers, ctxAt } = require('./helpers');
const { callTool } = require('../core/tools');
const drafts = require('../core/lib/drafts');
const approve = require('../hooks/approve');
const gate = require('../hooks/order-gate');

const NOW = '2026-10-14T05:00:00Z';

// The inline question the skill asks, and the hook payload after the investor clicks.
function question(code, { named = true, withNo = true } = {}) {
  return { header: named ? code : 'GTT plan', question: named ? `Place GTT plan ${code}? 2 places, 2 deletes.` : 'Place the GTT plan?', multiSelect: false, options: [...(withNo ? [{ label: "No, don't place" }] : []), { label: `Yes, place ${code}` }] };
}
function click(folder, code, answer = `Yes, place ${code}`, opts) {
  const q = question(code, opts);
  return approve.run({ hook_event_name: 'PostToolUse', tool_name: 'AskUserQuestion', cwd: folder, tool_input: { questions: [q] }, tool_response: { questions: [q], answers: { [q.question]: answer } } }, new Date(NOW));
}

async function planned() {
  const { folder } = tmpEnv();
  writeProfile(folder, fixture('profile.json'));
  const brokers = fakeBrokers({ kite: { data: fixture('kite-book.json') }, kotak: { status: { status: 'disabled' } } });
  const ctx = ctxAt(NOW, brokers);
  await callTool('refresh', { folder }, ctx);
  const d = await callTool('draft_gtt_plan', { folder }, ctx);
  assert.ok(d.ok && d.code, d.text);
  return { folder, brokers, ctx, code: d.code, draft: drafts.load(folder, d.code) };
}

test('draft text tells the model exactly which calls to make after the click', async () => {
  const { folder, ctx } = await planned();
  const d = await callTool('draft_gtt_plan', { folder }, ctx);
  assert.match(d.text, /Yes, place D/);
  assert.match(d.text, /Calls to make after Yes/);
  assert.match(d.text, /1\. place_gtt_order \{"exchange":/);
  assert.match(d.text, /delete_gtt_order \{"trigger_id":\d+\}/);
  assert.doesNotMatch(d.text, /execute_draft|approve <code>/);
});

test('every draft row names the broker tool and the exact arguments', async () => {
  const { draft } = await planned();
  assert.ok(draft.rows.every((r) => ['place_gtt_order', 'delete_gtt_order'].includes(r.tool) && r.args));
  assert.ok(draft.rows.filter((r) => r.tool === 'delete_gtt_order').every((r) => Number.isInteger(r.args.trigger_id)));
});

test("only the investor's click approves", async () => {
  const { folder, code } = await planned();
  const out = click(folder, code);
  assert.match(out.hookSpecificOutput.additionalContext, new RegExp(`approved ${code}`));
  assert.strictEqual(drafts.load(folder, code).status, 'approved');
});

test('"No", a question without the code, or one without a No option approves nothing', async () => {
  const { folder, code } = await planned();
  assert.strictEqual(click(folder, code, "No, don't place"), null);
  assert.strictEqual(click(folder, code, `Yes, place ${code}`, { named: false }), null);
  assert.strictEqual(click(folder, code, `Yes, place ${code}`, { withNo: false }), null);
  assert.strictEqual(approve.run({ tool_name: 'Bash', cwd: folder, tool_response: { answers: { x: `Yes, place ${code}` } } }), null);
  assert.strictEqual(drafts.load(folder, code).status, 'draft');
});

test('order gate blocks an approval question sent with its answer pre-filled', () => {
  const q = question('D5PZ2');
  const ask = (input) => gate.decide({ tool_name: 'AskUserQuestion', tool_input: input }, [], new Date(NOW)).allow;
  assert.strictEqual(ask({ questions: [q] }), true);
  assert.strictEqual(ask({ questions: [q], answers: { [q.question]: 'Yes, place D5PZ2' } }), false);
  assert.strictEqual(ask({ questions: [{ question: 'Which colour?', options: [{ label: 'Red' }, { label: 'Blue' }] }], answers: { 'Which colour?': 'Red' } }), true, 'other questions are not touched');
});

test('a click for a draft that does not exist here asks for a fresh draft', async () => {
  const { folder } = tmpEnv();
  const out = click(folder, 'DABCD');
  assert.match(out.hookSpecificOutput.additionalContext, /no open draft DABCD/);
});

test('a draft edited after approval is no longer approved', async () => {
  const { folder, code, draft } = await planned();
  click(folder, code);
  const d = drafts.load(folder, code);
  d.rows[0].args.quantity = (d.rows[0].args.quantity || d.rows[0].args.lower_quantity) + 100;
  drafts.save(folder, d);
  const place = draft.rows.find((r) => r.tool === 'place_gtt_order');
  assert.strictEqual(gate.decide({ tool_name: 'mcp__kite__place_gtt_order', tool_input: place.args }, [folder], new Date(NOW)).allow, false);
});

test('approval expires after 24 hours', async () => {
  const { folder, code, draft } = await planned();
  drafts.approve(folder, code, new Date(NOW));
  const place = draft.rows.find((r) => r.tool === 'place_gtt_order');
  const call = { tool_name: 'mcp__kite__place_gtt_order', tool_input: place.args };
  assert.strictEqual(gate.decide(call, [folder], new Date('2026-10-15T06:00:00Z')).allow, false);
  assert.strictEqual(gate.decide(call, [folder], new Date('2026-10-14T06:00:00Z')).allow, true);
});

test('order gate: matching approved row allowed once, any field changed denied', async () => {
  const { folder, code, draft } = await planned();
  const place = draft.rows.find((r) => r.tool === 'place_gtt_order');
  const del = draft.rows.find((r) => r.tool === 'delete_gtt_order');
  const name = 'mcp__kite__place_gtt_order';
  const now = new Date(NOW);
  assert.strictEqual(gate.decide({ tool_name: name, tool_input: place.args }, [folder], now).allow, false, 'unapproved must be denied');
  click(folder, code);
  for (const field of Object.keys(place.args).filter((k) => /quantity|trigger_value|limit_price/.test(k))) {
    const changed = { ...place.args, [field]: place.args[field] + 1 };
    assert.strictEqual(gate.decide({ tool_name: name, tool_input: changed }, [folder], now).allow, false, `${field} change must be denied`);
  }
  assert.strictEqual(gate.decide({ tool_name: name, tool_input: { ...place.args, extra_field: 1 } }, [folder], now).allow, false, 'an extra argument is a mismatch');
  assert.strictEqual(gate.decide({ tool_name: name, tool_input: place.args }, [folder], now).allow, true);
  const again = gate.decide({ tool_name: name, tool_input: place.args }, [folder], now);
  assert.strictEqual(again.allow, false, 'once per row');
  assert.match(again.reason, /already used once/);
  assert.strictEqual(gate.decide({ tool_name: 'mcp__kite__delete_gtt_order', tool_input: { trigger_id: del.args.trigger_id } }, [folder], now).allow, true);
  assert.strictEqual(gate.decide({ tool_name: 'mcp__kite__delete_gtt_order', tool_input: { trigger_id: 424242 } }, [folder], now).allow, false);
  assert.strictEqual(gate.decide({ tool_name: 'mcp__kite__modify_gtt_order', tool_input: place.args }, [folder], now).allow, false);
  assert.strictEqual(gate.decide({ tool_name: 'mcp__kite__cancel_order', tool_input: {} }, [folder], now).allow, false);
});

test('order gate matches by tool-name suffix on any prefix', async () => {
  const { folder, code, draft } = await planned();
  click(folder, code);
  const dels = draft.rows.filter((r) => r.tool === 'delete_gtt_order');
  const prefixes = ['mcp__kite__', 'mcp__remote-devices__kite__', 'mcp__claude_ai_Zerodha__', ''];
  assert.ok(dels.length >= 2);
  dels.slice(0, prefixes.length).forEach((r, i) => {
    assert.strictEqual(gate.decide({ tool_name: `${prefixes[i]}delete_gtt_order`, tool_input: r.args }, [folder], new Date(NOW)).allow, true, prefixes[i]);
  });
});

test('order gate: repeated claims of one row let exactly one through', async () => {
  const { folder, code, draft } = await planned();
  click(folder, code);
  const place = draft.rows.find((r) => r.tool === 'place_gtt_order');
  const results = [1, 2, 3].map(() => gate.decide({ tool_name: 'mcp__kite__place_gtt_order', tool_input: place.args }, [folder], new Date(NOW)).allow);
  assert.strictEqual(results.filter(Boolean).length, 1);
});

test('order gate script fails closed on bad input', () => {
  const { execFileSync } = require('child_process');
  const out = execFileSync(process.execPath, [path.join(__dirname, '..', 'hooks', 'order-gate.js')], { input: 'not json' }).toString();
  assert.strictEqual(JSON.parse(out).hookSpecificOutput.permissionDecision, 'deny');
});

test('order gate allows an approved basket row as an exact LIMIT buy only', async () => {
  const { folder } = tmpEnv();
  writeProfile(folder, fixture('profile.json'));
  const ctx = ctxAt(NOW, fakeBrokers({ kite: { data: fixture('kite-book.json') }, kotak: { status: { status: 'disabled' } } }));
  await callTool('refresh', { folder }, ctx);
  const b = await callTool('draft_basket', { folder, amount: 100000 }, ctx);
  const row = drafts.load(folder, b.code).rows[0];
  click(folder, b.code);
  const now = new Date(NOW);
  assert.strictEqual(gate.decide({ tool_name: 'mcp__kite__place_order', tool_input: { ...row.args, order_type: 'MARKET' } }, [folder], now).allow, false);
  assert.strictEqual(gate.decide({ tool_name: 'mcp__kite__place_order', tool_input: { ...row.args, transaction_type: 'SELL' } }, [folder], now).allow, false);
  assert.strictEqual(gate.decide({ tool_name: 'mcp__kite__place_order', tool_input: row.args }, [folder], now).allow, true);
});

test('draft_orders rows (IBKR instruction, cancel an open order) pass the gate once, only as shown', async () => {
  const { folder } = tmpEnv();
  const ctx = ctxAt(NOW, fakeBrokers());
  const bad = await callTool('draft_orders', { folder, rows: [{ tool: 'execute_anything', args: {} }] }, ctx);
  assert.strictEqual(bad.ok, false);
  const args = { contract_id_ex: '8314', side: 'BUY', quantity: 2, order_type: 'LIMIT', limit_price: 150.5, time_in_force: 'DAY' };
  const d = await callTool('draft_orders', { folder, rows: [{ tool: 'create_order_instruction', symbol: 'VWRA', args }, { tool: 'cancel_order', args: { variety: 'regular', order_id: '2610140001' } }] }, ctx);
  assert.ok(d.ok, d.text);
  click(folder, d.code);
  const now = new Date(NOW);
  const ibkr = 'mcp__claude_ai_Interactive_Brokers_IBKR__create_order_instruction';
  assert.strictEqual(gate.decide({ tool_name: ibkr, tool_input: { ...args, quantity: 3 } }, [folder], now).allow, false);
  assert.strictEqual(gate.decide({ tool_name: ibkr, tool_input: args }, [folder], now).allow, true);
  assert.strictEqual(gate.decide({ tool_name: ibkr, tool_input: args }, [folder], now).allow, false);
  assert.strictEqual(gate.decide({ tool_name: 'mcp__kite__cancel_order', tool_input: { variety: 'regular', order_id: '2610140001' } }, [folder], now).allow, true);
  assert.strictEqual(gate.decide({ tool_name: 'mcp__claude_ai_Interactive_Brokers_IBKR__submit_order', tool_input: args }, [folder], now).allow, false, 'live IBKR orders need their own approved row');
});

test('lite edition: the gate denies every broker write, even an approved one', async () => {
  const { folder, code, draft } = await planned();
  click(folder, code);
  const place = draft.rows.find((r) => r.tool === 'place_gtt_order');
  const call = { tool_name: 'mcp__kite__place_gtt_order', tool_input: place.args };
  assert.strictEqual(gate.decide(call, [folder], new Date(NOW), { edition: 'lite' }).allow, false);
  assert.match(gate.decide(call, [folder], new Date(NOW), { edition: 'lite' }).reason, /lite edition never places/);
  assert.strictEqual(gate.decide({ tool_name: 'mcp__kite__get_gtts', tool_input: {} }, [folder], new Date(NOW), { edition: 'lite' }).allow, true, 'reads are untouched');
});

test('lite plan text tells the investor to enter GTTs themselves', async () => {
  const { folder } = tmpEnv();
  writeProfile(folder, fixture('profile.json'));
  const ctx = ctxAt(NOW, fakeBrokers({ kite: { data: fixture('kite-book.json') }, kotak: { status: { status: 'disabled' } } }), 'lite');
  await callTool('refresh', { folder }, ctx);
  const d = await callTool('draft_gtt_plan', { folder }, ctx);
  assert.match(d.text, /Enter these in Kite web/);
  assert.doesNotMatch(d.text, /Calls to make after Yes/);
});

test('drafts live in the working folder state, not the repo', async () => {
  const { folder, code } = await planned();
  assert.ok(fs.existsSync(path.join(folder, 'portfolio-copilot', 'drafts', `${code}.json`)));
});
