'use strict';
// Spec 002, US1: one map of every broker MCP tool (contracts/broker-tools.md).
const test = require('node:test');
const assert = require('node:assert');
const { fixture } = require('./helpers');
const tm = require('../core/lib/brokers/toolmap');

const T = fixture('toolnames.json');
const input = (row) => (row.mode ? { mode: row.mode } : {});

test('every documented tool resolves to its broker, kind and capability under every prefix', () => {
  for (const row of T.tools) {
    for (const prefix of T.prefixes[row.broker]) {
      const r = tm.resolve(prefix + row.tool, input(row));
      const where = `${prefix}${row.tool} ${row.mode || ''}`;
      assert.strictEqual(r.broker, row.broker, where);
      assert.strictEqual(r.kind, row.kind, where);
      assert.strictEqual(r.cap, row.cap, where);
      assert.strictEqual(r.tool, row.tool, where);
      if (row.broker === 'kite') assert.strictEqual(r.generation, row.generation, where);
    }
  }
});

test('grouped Kite tools with no mode, or a mode not in the map, are unknown', () => {
  for (const tool of ['gtt', 'orders', 'portfolio', 'market', 'session', 'mutual_funds']) {
    assert.strictEqual(tm.resolve(`mcp__kite__${tool}`, {}).kind, 'unknown', `${tool} without mode`);
    assert.strictEqual(tm.resolve(`mcp__kite__${tool}`, { mode: 'frobnicate' }).kind, 'unknown', `${tool} bad mode`);
  }
});

test('made-up tools are unknown; Kite and IBKR are order-capable, Kotak is not', () => {
  const k = tm.resolve('mcp__kite__frobnicate', {});
  assert.strictEqual(k.kind, 'unknown');
  assert.strictEqual(k.order_capable, true);
  assert.strictEqual(tm.resolve('mcp__ibkr__transfer_funds', {}).order_capable, true);
  const ko = tm.resolve('mcp__kotak-neo__get_brand_new_report', {});
  assert.strictEqual(ko.kind, 'unknown');
  assert.strictEqual(ko.order_capable, false);
  assert.strictEqual(ko.looks_write, false);
  assert.strictEqual(tm.resolve('mcp__kotak-neo__place_order', {}).looks_write, true);
});

test('a tool that belongs to no broker resolves to no broker', () => {
  assert.strictEqual(tm.resolve('Bash', {}).broker, null);
  assert.strictEqual(tm.resolve('mcp__claude_ai_Gmail__list_drafts', {}).broker, null);
});

test('a bare tool name with no server falls back to the unique broker that has it', () => {
  assert.strictEqual(tm.resolve('place_gtt_order', {}).broker, 'kite');
  assert.strictEqual(tm.resolve('create_order_instruction', {}).broker, 'ibkr');
});

test('writeCall names the call for the generation in use, with the same arguments', () => {
  const args = { exchange: 'NSE', tradingsymbol: 'ALPHA', quantity: 5 };
  assert.deepStrictEqual(tm.writeCall('kite', 'gtt_write', 'place', args, 2), { tool: 'gtt', args: { mode: 'place', ...args } });
  assert.deepStrictEqual(tm.writeCall('kite', 'gtt_write', 'place', args, 1), { tool: 'place_gtt_order', args });
  assert.deepStrictEqual(tm.writeCall('kite', 'gtt_write', 'delete', { trigger_id: 7 }, 2), { tool: 'gtt', args: { mode: 'delete', trigger_id: 7 } });
  assert.deepStrictEqual(tm.writeCall('kite', 'gtt_write', 'delete', { trigger_id: 7 }, 1), { tool: 'delete_gtt_order', args: { trigger_id: 7 } });
  assert.deepStrictEqual(tm.writeCall('kite', 'order_write', 'place', args, 2), { tool: 'orders', args: { mode: 'place', ...args } });
  assert.deepStrictEqual(tm.writeCall('kite', 'order_write', 'cancel', { order_id: 'x' }, 1), { tool: 'cancel_order', args: { order_id: 'x' } });
  assert.deepStrictEqual(tm.writeCall('ibkr', 'order_write', 'place', args, 1), { tool: 'create_order_instruction', args });
  assert.throws(() => tm.writeCall('kotak', 'order_write', 'place', args, 1), /no write/);
});

test('every call writeCall returns resolves back to a write of the same capability', () => {
  for (const gen of [1, 2]) {
    for (const [cap, op] of [['gtt_write', 'place'], ['gtt_write', 'modify'], ['gtt_write', 'delete'], ['order_write', 'place'], ['order_write', 'modify'], ['order_write', 'cancel']]) {
      const c = tm.writeCall('kite', cap, op, {}, gen);
      const r = tm.resolve(`mcp__kite__${c.tool}`, c.args);
      assert.strictEqual(r.kind, 'write', `${cap} ${op} gen ${gen}`);
      assert.strictEqual(r.cap, cap);
    }
  }
});

test('readCalls lists the full-list reads per broker and generation', () => {
  const k2 = tm.readCalls('kite', 2);
  const holdings = k2.find((c) => c.cap === 'holdings');
  assert.deepStrictEqual(holdings.args, { mode: 'holdings', type: 'full', limit: 500 });
  assert.ok(k2.find((c) => c.cap === 'gtts' && c.required));
  assert.ok(k2.find((c) => c.cap === 'margins' && c.required));
  assert.ok(k2.find((c) => c.cap === 'mf' && !c.required));
  for (const c of k2) assert.strictEqual(tm.resolve(`mcp__kite__${c.tool}`, c.args).cap, c.cap, c.tool);
  const k1 = tm.readCalls('kite', 1);
  assert.ok(k1.every((c) => tm.resolve(`mcp__kite__${c.tool}`, c.args).generation === 1));
  assert.deepStrictEqual(tm.readCalls('kotak', 1).filter((c) => c.required).map((c) => c.cap).sort(), ['holdings', 'margins']);
});

test('generation follows the Kite tools present, newest when unknown', () => {
  assert.strictEqual(tm.generation('kite', ['mcp__kite__get_holdings', 'mcp__kite__get_gtts']), 1);
  assert.strictEqual(tm.generation('kite', ['mcp__kite__portfolio', 'mcp__kite__gtt']), 2);
  assert.strictEqual(tm.generation('kite', []), 2);
  assert.strictEqual(tm.generation('kite', undefined), 2);
});

test('doctor reports read and write paths per enabled broker, and unknown tools', () => {
  const profile = { brokers: { kite: { enabled: true }, kotak: { enabled: true }, ibkr: { enabled: false } } };
  const present = ['mcp__kite__session', 'mcp__kite__portfolio', 'mcp__kite__gtt', 'mcp__kite__orders', 'mcp__kite__mutual_funds', 'mcp__kite__teleport', 'mcp__kotak-neo__get_login', 'mcp__kotak-neo__get_holdings', 'mcp__kotak-neo__get_limits'];
  const d = tm.doctor(present, profile);
  const kite = d.find((b) => b.broker === 'kite');
  assert.strictEqual(kite.read_path, true);
  assert.strictEqual(kite.write_path, true);
  assert.strictEqual(kite.generation, 2);
  assert.deepStrictEqual(kite.unknown, ['mcp__kite__teleport']);
  const kotak = d.find((b) => b.broker === 'kotak');
  assert.strictEqual(kotak.read_path, true);
  assert.strictEqual(kotak.write_path, null, 'read-only broker');
  assert.ok(!d.find((b) => b.broker === 'ibkr'), 'disabled broker not listed');
  const gone = tm.doctor(['mcp__kite__get_profile'], profile).find((b) => b.broker === 'kite');
  assert.strictEqual(gone.read_path, false);
  assert.ok(gone.missing.includes('holdings'));
});

test('doctor and report_gap --flush run through the engine', async () => {
  const { tmpEnv, writeProfile, ctxAt, fakeBrokers } = require('./helpers');
  const { callTool } = require('../core/tools');
  const gap = require('../core/lib/gap');
  const { folder } = tmpEnv();
  writeProfile(folder, fixture('profile.json'));
  const ctx = ctxAt('2026-11-16T05:00:00Z', fakeBrokers({}));
  const d = await callTool('doctor', { folder, tools: ['mcp__kite__session', 'mcp__kite__portfolio', 'mcp__kite__gtt', 'mcp__kite__teleport', 'mcp__kotak-neo__get_holdings', 'mcp__kotak-neo__get_limits'] }, ctx);
  assert.ok(d.ok, d.text);
  assert.match(d.text, /portfolio \{"mode":"holdings","type":"full","limit":500\}/);
  assert.match(d.text, /teleport/);
  assert.strictEqual((await callTool('doctor', { folder }, ctx)).ok, false);
  gap.queuePending({ title: 'Unknown kotak tool: get_new', missing: 'tool map entry' });
  gap.queuePending({ title: 'Unknown kotak tool: get_new', missing: 'tool map entry' });
  const f = await callTool('report_gap', { folder, flush: true }, ctx);
  assert.strictEqual(f.flushed, 1, f.text);
  assert.strictEqual((await callTool('report_gap', { folder, flush: true }, ctx)).flushed, 0);
});
