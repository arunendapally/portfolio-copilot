'use strict';
// Spec 002, US1: the order gate covers every broker write under both Kite tool generations
// (contracts/hooks.md). Deterministic, fail closed.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { tmpEnv, fixture, runHook } = require('./helpers');
const drafts = require('../core/lib/drafts');
const state = require('../core/lib/state');
const gate = require('../hooks/order-gate');

const T = fixture('toolnames.json');
const NOW = new Date('2026-11-16T05:00:00Z');
const input = (row) => (row.mode ? { mode: row.mode } : {});

function approved(folder, rows) {
  const d = drafts.create(folder, 'gtt_plan', rows.map((r, i) => ({ step: i + 1, ...r })), { label: 'test' });
  drafts.approve(folder, d.code, NOW);
  return d.code;
}

const PLACE = { mode: 'place', exchange: 'NSE', tradingsymbol: 'ALPHA', transaction_type: 'SELL', product: 'CNC', trigger_type: 'single', trigger_value: 390, quantity: 40, limit_price: 388, last_price: 560 };

test('with no approved draft, every write under every prefix is denied', () => {
  const { folder } = tmpEnv();
  for (const row of T.tools.filter((r) => r.kind === 'write')) {
    for (const prefix of T.prefixes[row.broker]) {
      const d = gate.decide({ tool_name: prefix + row.tool, tool_input: input(row) }, [folder], NOW);
      assert.strictEqual(d.allow, false, `${prefix}${row.tool} ${row.mode || ''}`);
      assert.match(d.reason, /draft/);
    }
  }
});

test('reads and session calls pass without a draft', () => {
  const { folder } = tmpEnv();
  for (const row of T.tools.filter((r) => r.kind !== 'write')) {
    const d = gate.decide({ tool_name: T.prefixes[row.broker][0] + row.tool, tool_input: input(row) }, [folder], NOW);
    assert.strictEqual(d.allow, true, `${row.tool} ${row.mode || ''}`);
  }
});

test('a generation-2 GTT write passes once when it matches an approved row; the repeat is denied', () => {
  const { folder } = tmpEnv();
  approved(folder, [{ tool: 'gtt', args: PLACE }, { tool: 'gtt', args: { mode: 'delete', trigger_id: 9001 } }]);
  const call = (args, prefix = 'mcp__remote-devices__kite__') => gate.decide({ tool_name: `${prefix}gtt`, tool_input: args }, [folder], NOW);
  assert.strictEqual(call(PLACE).allow, true);
  const again = call(PLACE);
  assert.strictEqual(again.allow, false);
  assert.match(again.reason, /already used once/);
  assert.strictEqual(call({ mode: 'delete', trigger_id: 9001 }, 'mcp__claude_ai_Kite__').allow, true);
  assert.strictEqual(call({ mode: 'delete', trigger_id: 9002 }).allow, false, 'a different GTT id');
});

test('mode is compared: an approved place does not let a modify through', () => {
  const { folder } = tmpEnv();
  approved(folder, [{ tool: 'gtt', args: PLACE }]);
  assert.strictEqual(gate.decide({ tool_name: 'mcp__kite__gtt', tool_input: { ...PLACE, mode: 'modify' } }, [folder], NOW).allow, false);
  assert.strictEqual(gate.decide({ tool_name: 'mcp__kite__orders', tool_input: PLACE }, [folder], NOW).allow, false, 'another tool');
});

test('informational arguments are ignored: live price, tag, request id, approval method', () => {
  const { folder } = tmpEnv();
  approved(folder, [{ tool: 'gtt', args: PLACE }]);
  const d = gate.decide({ tool_name: 'mcp__kite__gtt', tool_input: { ...PLACE, last_price: 571.2, tag: 'x', _app_request_id: 'r1', approval_method: 'browser' } }, [folder], NOW);
  assert.strictEqual(d.allow, true);
});

test('an extra argument the draft did not show is a mismatch', () => {
  const { folder } = tmpEnv();
  approved(folder, [{ tool: 'gtt', args: PLACE }]);
  assert.strictEqual(gate.decide({ tool_name: 'mcp__kite__gtt', tool_input: { ...PLACE, quantity: 400 } }, [folder], NOW).allow, false);
});

test('Kite orders permissions is a write and is never drafted, so it is always denied', () => {
  const { folder } = tmpEnv();
  const d = gate.decide({ tool_name: 'mcp__kite__orders', tool_input: { mode: 'permissions', action: 'allow_future_orders' } }, [folder], NOW);
  assert.strictEqual(d.allow, false);
});

test('unknown tools on order-capable brokers are denied with a clear reason', () => {
  const { folder } = tmpEnv();
  for (const [name, broker] of [['mcp__kite__teleport', 'kite'], ['mcp__kite__gtt', 'kite'], ['mcp__ibkr__transfer_funds', 'ibkr']]) {
    const d = gate.decide({ tool_name: name, tool_input: {} }, [folder], NOW);
    assert.strictEqual(d.allow, false, name);
    assert.match(d.reason, new RegExp(`does not know this ${broker} tool`), name);
    assert.match(d.reason, /Nothing was sent/);
  }
});

test('unknown Kotak tools pass and are queued as a gap; an order-shaped one is denied', () => {
  const { folder } = tmpEnv();
  assert.strictEqual(gate.decide({ tool_name: 'mcp__kotak-neo__get_brand_new_report', tool_input: {} }, [folder], NOW).allow, true);
  const q = JSON.parse(fs.readFileSync(path.join(state.configDir(), 'gaps-pending.json'), 'utf8'));
  assert.ok(q.some((g) => /get_brand_new_report/.test(g.title)), JSON.stringify(q));
  assert.strictEqual(gate.decide({ tool_name: 'mcp__kotak-neo__place_order', tool_input: {} }, [folder], NOW).allow, false);
});

test('tools of no broker are not the gate\'s business', () => {
  const { folder } = tmpEnv();
  assert.strictEqual(gate.decide({ tool_name: 'Bash', tool_input: {} }, [folder], NOW).allow, true);
});

test('lite edition denies every write, even with an approved row', () => {
  const { folder } = tmpEnv();
  approved(folder, [{ tool: 'gtt', args: PLACE }]);
  assert.strictEqual(gate.decide({ tool_name: 'mcp__kite__gtt', tool_input: PLACE }, [folder], NOW, { edition: 'lite' }).allow, false);
});

test('the hook process denies a generation-2 write and stays silent on a read', () => {
  const { folder } = tmpEnv();
  const deny = runHook('order-gate.js', { tool_name: 'mcp__kite__gtt', tool_input: PLACE, cwd: folder });
  assert.strictEqual(deny.out.hookSpecificOutput.permissionDecision, 'deny');
  const read = runHook('order-gate.js', { tool_name: 'mcp__kite__gtt', tool_input: { mode: 'list' }, cwd: folder });
  assert.strictEqual(read.out, null);
});

test('malformed input fails closed', () => {
  const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'hooks', 'order-gate.js')], { input: 'not json', encoding: 'utf8' });
  assert.strictEqual(JSON.parse(r.stdout).hookSpecificOutput.permissionDecision, 'deny');
});

test('a review task question sent with its answer filled in is denied (T057)', () => {
  const q = { header: 't_9f2c4a1b2c3d', question: 'Raise ALPHA stop to cost?', options: [{ label: 'Approve' }, { label: 'Defer' }, { label: 'Decline' }] };
  const ask = (tool_input) => gate.decide({ tool_name: 'AskUserQuestion', tool_input }, [], NOW).allow;
  assert.strictEqual(ask({ questions: [q], answers: { [q.question]: 'Approve' } }), false);
  assert.strictEqual(ask({ questions: [q] }), true, 'asking is fine');
  assert.strictEqual(ask({ questions: [{ ...q, header: 'Broker' }], answers: { [q.question]: 'Approve' } }), true, 'other questions are not task decisions');
});
