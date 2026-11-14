#!/usr/bin/env node
'use strict';
// SessionStart: inject the house rules through additionalContext (works on Windows, where
// `cat` does not exist) and resolve the file relative to this script.

const fs = require('fs');
const path = require('path');
const { manifest } = require('../core/lib/version');
const gap = require('../core/lib/gap');
const { readJson } = require('../core/lib/state');

try {
  const rules = fs.readFileSync(path.join(__dirname, '..', 'context', 'house-rules.md'), 'utf8');
  const m = manifest();
  let queued = 0;
  try { queued = readJson(gap.pendingPath(), []).length; } catch { /* the queue is optional */ }
  const pc = `node "${path.join(__dirname, '..', 'core', 'bin', 'pc.js')}"`;
  const handshake = `

portfolio-copilot hooks: plugin ${m.name}, version ${m.version}. Portfolio engine (no server; reads come from the broker MCPs): run ${pc} COMMAND --folder "INVESTOR_FOLDER" [--json '{...}']; COMMAND list shows them. When you run broker_status, add --hook_plugin ${m.name} --hook_version ${m.version} so a version or edition mismatch is reported. If more than one 'portfolio-copilot hooks:' line is in your context, two editions or versions are loaded: tell the investor once, naming the extra one to remove. Before the first broker read, run doctor with --json '{"tools":[every broker MCP tool name you can see]}': it names the exact read calls for the tools this chat has, so never guess a broker tool name.${queued ? ` ${queued} broker gap(s) are queued from earlier sessions: run report_gap with --json '{"flush":true}'.` : ''}`;
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: rules + handshake } }));
} catch (err) {
  // Fail open for the session, but tell the model protection is degraded so it says so.
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: `portfolio-copilot: house rules could not be loaded (${err.message}). Tell the investor in your first reply that protection is degraded, and place no orders.`,
    },
  }));
}
