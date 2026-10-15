'use strict';
// MCP stdio protocol and performance budgets (SC-001, constitution VI).
const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('child_process');
const path = require('path');
const { createServer } = require('../core/server');
const { tmpEnv, writeProfile, fixture, fakeBrokers, ctxAt } = require('./helpers');
const { callTool } = require('../core/tools');

function rpc(server) {
  const out = [];
  const s = createServer(server, (line) => out.push(JSON.parse(line)));
  return { out, send: (m) => s.receive(JSON.stringify(m)) };
}

test('initialize, tools/list and tools/call follow MCP', async () => {
  tmpEnv();
  const { out, send } = rpc({ edition: 'full', brokers: fakeBrokers(), now: () => new Date() });
  await send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } });
  await send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  await send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  await send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'profile_get', arguments: { path: 'gtt_policy.crash_floor_pct' } } });
  await send({ jsonrpc: '2.0', id: 4, method: 'nope' });
  assert.strictEqual(out.length, 4, 'notifications must not get replies');
  assert.strictEqual(out[0].result.protocolVersion, '2025-06-18');
  assert.ok(out[1].result.tools.length >= 13);
  for (const t of out[1].result.tools) assert.strictEqual(t.inputSchema.type, 'object');
  assert.match(out[2].result.content[0].text, /25/);
  assert.strictEqual(out[2].result.structuredContent, undefined, 'the model must get the text, not structuredContent');
  assert.strictEqual(out[3].error.code, -32601);
});

test('server starts as a real process and answers over stdio', async () => {
  const p = spawn(process.execPath, [path.join(__dirname, '..', 'core', 'server.js')], { env: { ...process.env, PORTFOLIO_EDITION: 'lite' } });
  const reply = new Promise((resolve) => {
    let buf = '';
    p.stdout.on('data', (d) => { buf += d; const lines = buf.split('\n').filter(Boolean); if (lines.length >= 2) resolve(lines.map((l) => JSON.parse(l))); });
  });
  p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }) + '\n');
  p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) + '\n');
  const [init, list] = await reply;
  p.kill();
  assert.strictEqual(init.result.serverInfo.name, 'portfolio-core');
  assert.ok(!list.result.tools.some((t) => t.name === 'execute_draft'), 'lite must not expose execute_draft');
});

test('150-holding book: refresh + audit fast and compact', async () => {
  const { folder } = tmpEnv();
  writeProfile(folder, fixture('profile.json'));
  const book = fixture('kite-book.json');
  const holdings = [];
  const gtts = [];
  for (let i = 0; i < 150; i++) {
    holdings.push({ tradingsymbol: `SYM${i}`, exchange: 'NSE', quantity: 10 + i, t1_quantity: 0, average_price: 100, last_price: 100 + (i % 40), day_change: 1 });
    gtts.push({ id: 1000 + i, type: 'two-leg', status: 'active', condition: { exchange: 'NSE', tradingsymbol: `SYM${i}`, trigger_values: [70 + (i % 30), 200], last_price: 100 }, orders: [{ transaction_type: 'SELL', quantity: 10 + i - (i % 3), price: 69 }, { transaction_type: 'SELL', quantity: 10 + i, price: 200 }] });
  }
  const big = { ...book, holdings, gtts, orders: [] };
  const brokers = fakeBrokers({ kite: { data: big }, kotak: { status: { status: 'disabled' } } });
  const ctx = ctxAt('2026-10-14T05:00:00Z', brokers);
  const t0 = Date.now();
  const r = await callTool('refresh', { folder }, ctx);
  const a = await callTool('gtt_audit', { folder }, ctx);
  const ms = Date.now() - t0;
  assert.ok(ms < 2000, `took ${ms} ms`);
  // Tool text the model reads: far below the 64-72K-char raw GTT payloads seen in the field.
  assert.ok(r.text.length < 8000, `check text ${r.text.length} chars`);
  assert.ok(a.text.length < 20000, `audit text ${a.text.length} chars`);
});
