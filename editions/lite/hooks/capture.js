#!/usr/bin/env node
'use strict';
// PostToolUse and PostToolUseFailure (broker read tools): saves what the broker's own MCP
// returned, so the pc script computes from the real payload. A failed read is saved too, so a
// logged-out broker shows as needs_login. Reads only; it never blocks and never calls a broker.

const session = require('../core/lib/session');
const { readStdin } = require('./lib');

function run(input, now = new Date()) {
  const tool = String(input.tool_name || '');
  if (!/__(get|list)_[a-z_]+$/.test(tool)) return null;
  const resp = input.hook_event_name === 'PostToolUseFailure'
    ? { isError: true, content: [{ type: 'text', text: String(input.error || 'tool call failed') }] }
    : input.tool_response;
  return session.record(tool, resp, now, input.tool_input);
}

if (require.main === module) {
  readStdin().then((raw) => {
    try {
      run(JSON.parse(raw || '{}'));
    } catch (e) {
      process.stderr.write(`[portfolio-copilot] capture hook: ${e.message}\n`);
    }
  });
}

module.exports = { run };
