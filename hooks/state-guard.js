#!/usr/bin/env node
'use strict';
// PreToolUse for file and shell tools (security review, 18-Nov-2026): denies writing the
// investor's drafts by hand and any access to the per-machine folder that holds approvals,
// used-row markers, the approval key and broker secrets. The engine and hooks write those files
// themselves; the model never needs to. Fails closed.

const { readStdin } = require('./lib');

// Paths written as typed in a tool call: forward or back slashes, any case.
const PROTECTED = [/\.portfolio-copilot(?:[\\/]|$|["'\s])/i, /portfolio_copilot_config_dir/i, /approval\.key/i, /[\\/]secrets[\\/](kite|ibkr|kotak)\.json/i];
const DRAFTS = /portfolio-copilot[\\/]+drafts(?:[\\/]|$|["'\s])/i;

function targets(input) {
  const a = input.tool_input || {};
  return [a.file_path, a.notebook_path, a.path, a.command, a.pattern].filter((x) => typeof x === 'string');
}

function decide(input) {
  const tool = String(input.tool_name || '');
  const text = targets(input).join('\n');
  if (!text) return { allow: true };
  if (PROTECTED.some((re) => re.test(text))) {
    return { allow: false, reason: `Blocked ${tool}: it touches the per-machine folder that holds approvals, used-row markers and broker secrets. Only the plugin's own hooks and engine use it.` };
  }
  const writes = /^(Write|Edit|MultiEdit|NotebookEdit)$/.test(tool) || ((tool === 'Bash' || tool === 'PowerShell') && /(>|\b(rm|del|mv|cp|copy|move|tee|sed\s+-i|Set-Content|Out-File|Remove-Item|New-Item|ren|rename)\b)/i.test(text));
  if (writes && DRAFTS.test(text)) {
    return { allow: false, reason: `Blocked ${tool}: drafts are written only by the engine (draft commands) and approved only by your click.` };
  }
  return { allow: true };
}

if (require.main === module) {
  readStdin().then((raw) => {
    let d;
    try { d = decide(JSON.parse(raw || '{}')); } catch (e) { d = { allow: false, reason: `State guard error (${e.message}); failing closed.` }; }
    if (!d.allow) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: d.reason } }));
  });
}

module.exports = { decide };
