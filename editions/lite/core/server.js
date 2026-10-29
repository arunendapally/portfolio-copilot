#!/usr/bin/env node
'use strict';
// portfolio-core: stdio MCP server (newline-delimited JSON-RPC). Zero dependencies.

const readline = require('readline');
const { listTools, callTool, makeContext } = require('./tools');

const SUPPORTED = ['2025-06-18', '2025-03-26', '2024-11-05'];

function createServer(ctx = makeContext(), write = (s) => process.stdout.write(s)) {
  const send = (msg) => write(JSON.stringify(msg) + '\n');

  async function handle(msg) {
    if (!msg || msg.jsonrpc !== '2.0') return;
    const { id, method, params } = msg;
    const reply = (result) => id !== undefined && send({ jsonrpc: '2.0', id, result });
    const fail = (code, message) => id !== undefined && send({ jsonrpc: '2.0', id, error: { code, message } });
    switch (method) {
      case 'initialize': {
        const asked = params && params.protocolVersion;
        return reply({
          protocolVersion: SUPPORTED.includes(asked) ? asked : SUPPORTED[0],
          capabilities: { tools: {} },
          serverInfo: { name: 'portfolio-core', version: '0.6.0' },
          instructions: 'Deterministic portfolio engine. Show each tool\'s `text` as is. Never compute portfolio numbers yourself.',
        });
      }
      case 'notifications/initialized':
      case 'notifications/cancelled':
        return undefined;
      case 'ping':
        return reply({});
      case 'tools/list':
        return reply({ tools: listTools(ctx.edition) });
      case 'tools/call': {
        const r = await callTool(params && params.name, (params && params.arguments) || {}, ctx);
        const { text, ...data } = r;
        // Text only: Claude Code hands structuredContent to the model in place of the text,
        // which dropped every report's tables (smoke test, 15-Oct-2026).
        return reply({
          content: [{ type: 'text', text: text || JSON.stringify(data) }],
          isError: r.ok === false,
        });
      }
      default:
        if (method && method.startsWith('notifications/')) return undefined;
        return fail(-32601, `Method not found: ${method}`);
    }
  }

  return {
    async receive(line) {
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        return send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
      }
      try {
        await handle(msg);
      } catch (e) {
        if (msg.id !== undefined) send({ jsonrpc: '2.0', id: msg.id, error: { code: -32603, message: e.message } });
      }
    },
  };
}

if (require.main === module) {
  const server = createServer();
  const rl = readline.createInterface({ input: process.stdin });
  rl.on('line', (line) => { if (line.trim()) server.receive(line); });
}

module.exports = { createServer };
