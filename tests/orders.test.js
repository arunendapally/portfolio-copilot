'use strict';
// US4: orders only from drafts the investor approved. Deterministic, fail closed.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { tmpEnv, fixture, writeProfile, fakeBrokers, ctxAt } = require('./helpers');
const { callTool, listTools } = require('../core/tools');
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

test('draft text tells the investor exactly how to approve', async () => {
  const { code, ctx, folder } = await planned();
  const r = await callTool('check', { folder }, ctx);
  assert.ok(r.ok);
  assert.match(code, drafts.CODE_RE);
});

test('execute_draft refuses an unapproved draft', async () => {
  const { folder, ctx, code, brokers } = await planned();
  const r = await callTool('execute_draft', { folder, code }, ctx);
  assert.strictEqual(r.ok, false);
  assert.match(r.text, /not approved/);
  assert.strictEqual(brokers.calls.length, 0);
});

test("only the investor's click approves; then execute places before deleting", async () => {
  const { folder, ctx, code, brokers, draft } = await planned();
  const out = click(folder, code);
  assert.match(out.hookSpecificOutput.additionalContext, new RegExp(`approved ${code}`));
  const r = await callTool('execute_draft', { folder, code }, ctx);
  assert.ok(r.ok, r.text);
  const kinds = brokers.calls.map((c) => c[0]);
  assert.strictEqual(kinds.lastIndexOf('place') < kinds.indexOf('delete'), true);
  assert.strictEqual(kinds.filter((k) => k === 'place').length, draft.rows.filter((x) => x.action === 'place').length);
  assert.strictEqual(drafts.load(folder, code).status, 'executed');
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

test('cloud chat linked to the PC: one call through the gate, PC opt-in required (issue #9)', async () => {
  const { folder, ctx, code, brokers } = await planned();
  const pcConfig = process.env.PORTFOLIO_COPILOT_CONFIG_DIR;
  const cloud = fs.mkdtempSync(path.join(require('os').tmpdir(), 'pc-cloud-'));
  const cloudCwd = path.join(cloud, 'cwd');
  fs.mkdirSync(cloudCwd);
  process.env.PORTFOLIO_COPILOT_CONFIG_DIR = path.join(cloud, 'config'); // the cloud container cannot see the PC
  try {
    const out = click(cloudCwd, code);
    assert.match(out.hookSpecificOutput.additionalContext, /on the linked computer.*remote_approval true/);
    const call = { tool_name: 'mcp__remote-devices__plugin_portfolio-copilot_portfolio-core__execute_draft', tool_input: { code, remote_approval: true } };
    assert.strictEqual(gate.decide({ ...call, tool_input: { code } }, [cloudCwd], new Date(NOW)).allow, false, 'flag required');
    assert.strictEqual(gate.decide(call, [cloudCwd], new Date(NOW)).allow, true, 'first call through');
    assert.strictEqual(gate.decide(call, [cloudCwd], new Date(NOW)).allow, false, 'consumed: no replay');
    assert.strictEqual(gate.decide({ ...call, tool_input: { code: 'DZZZZ', remote_approval: true } }, [cloudCwd], new Date(NOW)).allow, false, 'never clicked');
  } finally {
    process.env.PORTFOLIO_COPILOT_CONFIG_DIR = pcConfig;
  }
  // On the PC: refused while the opt-in is off, executed once it is on.
  const off = await callTool('execute_draft', { folder, code, remote_approval: true }, ctx);
  assert.strictEqual(off.ok, false);
  assert.match(off.text, /switched off on this computer/);
  assert.strictEqual(brokers.calls.length, 0);
  const p = fixture('profile.json');
  p.orders = { allow_remote_approval: true };
  writeProfile(folder, p);
  const on = await callTool('execute_draft', { folder, code, remote_approval: true }, ctx);
  assert.ok(on.ok, on.text);
  assert.strictEqual(drafts.load(folder, code).approved_via, 'inline question, cloud gate');
});

test('PC refuses a remote approval for a draft changed after it was shown', async () => {
  const { folder, ctx, code, brokers } = await planned();
  const p = fixture('profile.json');
  p.orders = { allow_remote_approval: true };
  writeProfile(folder, p);
  const d = drafts.load(folder, code);
  d.rows[0].args.quantity = (d.rows[0].args.quantity || d.rows[0].args.lower_quantity) + 100;
  drafts.save(folder, d);
  const r = await callTool('execute_draft', { folder, code, remote_approval: true }, ctx);
  assert.strictEqual(r.ok, false);
  assert.match(r.text, /changed since it was shown/);
  assert.strictEqual(brokers.calls.length, 0);
});

test('a draft edited after approval is no longer approved', async () => {
  const { folder, ctx, code } = await planned();
  click(folder, code);
  const d = drafts.load(folder, code);
  d.rows[0].args.quantity = (d.rows[0].args.quantity || d.rows[0].args.lower_quantity) + 100;
  drafts.save(folder, d);
  const r = await callTool('execute_draft', { folder, code }, ctx);
  assert.strictEqual(r.ok, false);
  assert.match(r.text, /changed after approval/);
});

test('approval expires after 24 hours', async () => {
  const { folder, brokers, code } = await planned();
  drafts.approve(folder, code, new Date(NOW));
  const r = await callTool('execute_draft', { folder, code }, ctxAt('2026-10-15T06:00:00Z', brokers));
  assert.match(r.text, /older than 24 h/);
});

test('a failed placement deletes nothing (no holding left unprotected)', async () => {
  const { folder, ctx, code, brokers } = await planned();
  click(folder, code);
  brokers.kite.placeGtt = async () => { throw new Error('rejected'); };
  const r = await callTool('execute_draft', { folder, code }, ctx);
  assert.strictEqual(r.ok, false);
  assert.ok(!brokers.calls.some((c) => c[0] === 'delete'));
  assert.match(r.text, /no old GTT was deleted/);
});

test('broken broker delete falls back to a manual delete list', async () => {
  const { folder, ctx, code, brokers } = await planned();
  click(folder, code);
  brokers.kite.deleteGtt = async () => { throw new Error("parameter 'trigger_id': is required"); };
  const r = await callTool('execute_draft', { folder, code }, ctx);
  assert.match(r.text, /Delete manually in Kite web \(Orders > GTT\): #/);
});

test('order gate: matching approved row allowed, any field changed denied', async () => {
  const { folder, code, draft } = await planned();
  const place = draft.rows.find((r) => r.action === 'place');
  const del = draft.rows.find((r) => r.action === 'delete');
  const name = 'mcp__kite__place_gtt_order';
  const now = new Date(NOW);
  assert.strictEqual(gate.decide({ tool_name: name, tool_input: place.args }, [folder], now).allow, false, 'unapproved must be denied');
  click(folder, code);
  assert.strictEqual(gate.decide({ tool_name: name, tool_input: place.args }, [folder], now).allow, true);
  for (const field of Object.keys(place.args).filter((k) => /quantity|trigger_value|limit_price/.test(k))) {
    const changed = { ...place.args, [field]: place.args[field] + 1 };
    assert.strictEqual(gate.decide({ tool_name: name, tool_input: changed }, [folder], now).allow, false, `${field} change must be denied`);
  }
  assert.strictEqual(gate.decide({ tool_name: 'mcp__plugin_portfolio-copilot_kite__delete_gtt_order', tool_input: { trigger_id: del.gtt_id } }, [folder], now).allow, true);
  assert.strictEqual(gate.decide({ tool_name: 'mcp__kite__delete_gtt_order', tool_input: { trigger_id: 424242 } }, [folder], now).allow, false);
  assert.strictEqual(gate.decide({ tool_name: 'mcp__kite__modify_gtt_order', tool_input: place.args }, [folder], now).allow, false);
  assert.strictEqual(gate.decide({ tool_name: 'mcp__kite__cancel_order', tool_input: {} }, [folder], now).allow, false);
});

test('order gate: execute_draft allowed only when approved', async () => {
  const { folder, code } = await planned();
  const call = { tool_name: 'mcp__plugin_portfolio-copilot_portfolio-core__execute_draft', tool_input: { code } };
  assert.strictEqual(gate.decide(call, [folder], new Date(NOW)).allow, false);
  click(folder, code);
  assert.strictEqual(gate.decide(call, [folder], new Date(NOW)).allow, true);
});

test('order gate script fails closed on bad input', () => {
  const { execFileSync } = require('child_process');
  const out = execFileSync(process.execPath, [path.join(__dirname, '..', 'hooks', 'order-gate.js')], { input: 'not json' }).toString();
  assert.strictEqual(JSON.parse(out).hookSpecificOutput.permissionDecision, 'deny');
});

test('order gate allows an approved basket row as a LIMIT buy only', async () => {
  const { folder } = tmpEnv();
  writeProfile(folder, fixture('profile.json'));
  const brokers = fakeBrokers({ kite: { data: fixture('kite-book.json') }, kotak: { status: { status: 'disabled' } } });
  const ctx = ctxAt(NOW, brokers);
  await callTool('refresh', { folder }, ctx);
  const b = await callTool('draft_basket', { folder, amount: 100000 }, ctx);
  const row = drafts.load(folder, b.code).rows[0];
  click(folder, b.code);
  const ok = { tradingsymbol: row.symbol, transaction_type: 'BUY', quantity: row.qty, order_type: 'LIMIT', price: row.limit_price };
  assert.strictEqual(gate.decide({ tool_name: 'mcp__kite__place_order', tool_input: ok }, [folder], new Date(NOW)).allow, true);
  assert.strictEqual(gate.decide({ tool_name: 'mcp__kite__place_order', tool_input: { ...ok, order_type: 'MARKET' } }, [folder], new Date(NOW)).allow, false);
  const ex = await callTool('execute_draft', { folder, code: b.code }, ctx);
  assert.match(ex.text, /entered and executed by you/);
});

test('lite edition has no execute tool', async () => {
  assert.ok(listTools('full').some((t) => t.name === 'execute_draft'));
  assert.ok(!listTools('lite').some((t) => t.name === 'execute_draft'));
  const { folder } = tmpEnv();
  const r = await callTool('execute_draft', { folder, code: 'DAAAA' }, ctxAt(NOW, fakeBrokers(), 'lite'));
  assert.match(r.text, /Unknown tool/);
});

test('lite plan text tells the investor to enter GTTs themselves', async () => {
  const { folder } = tmpEnv();
  writeProfile(folder, fixture('profile.json'));
  const brokers = fakeBrokers({ kite: { data: fixture('kite-book.json') }, kotak: { status: { status: 'disabled' } } });
  const ctx = ctxAt(NOW, brokers, 'lite');
  await callTool('refresh', { folder }, ctx);
  const d = await callTool('draft_gtt_plan', { folder }, ctx);
  assert.match(d.text, /Enter these in Kite web/);
  assert.doesNotMatch(d.text, /execute_draft/);
});

test('drafts live in the working folder state, not the repo', async () => {
  const { folder, code } = await planned();
  assert.ok(fs.existsSync(path.join(folder, 'portfolio-copilot', 'drafts', `${code}.json`)));
});
