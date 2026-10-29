#!/usr/bin/env node
'use strict';
// portfolio-copilot engine as a plain script, so it works in any chat that can run node: no
// server, no broker logins. Reads come from the brokers' own MCP tools via hooks/capture.js.
//   node pc.js <command> [--folder DIR] [--key value ...] [--json '{"key": value}']
// <command> is a tool name (broker_status, refresh, gtt_audit, draft_gtt_plan, ...); `list` shows them.

const { TOOLS, callTool, makeContext } = require('../tools');

function value(v) {
  try { return JSON.parse(v); } catch { return v; }
}

function parse(argv) {
  const args = {};
  let command = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') Object.assign(args, JSON.parse(argv[++i]));
    else if (a.startsWith('--')) args[a.slice(2).replace(/-/g, '_')] = value(argv[++i]);
    else if (!command) command = a;
  }
  return { command, args };
}

async function main(argv, out = (s) => process.stdout.write(s)) {
  const { command, args } = parse(argv);
  if (!command || command === 'list') {
    out(`${TOOLS.map((t) => `${t.name}: ${t.description}`).join('\n')}\n`);
    return 0;
  }
  const r = await callTool(command, args, makeContext());
  out(`${r.text || JSON.stringify(r)}\n`);
  return r.ok === false ? 1 : 0;
}

if (require.main === module) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}

module.exports = { main, parse };
