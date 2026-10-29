#!/usr/bin/env node
'use strict';
// PostToolUse (broker read tools): saves what the broker's own MCP returned, so the pc script
// computes from the real payload. Reads only; it never blocks and never calls a broker.

const session = require('../core/lib/session');
const { readStdin } = require('./lib');

function run(input, now = new Date()) {
  const tool = String(input.tool_name || '');
  if (!/__(get|list)_[a-z_]+$/.test(tool)) return null;
  return session.record(tool, input.tool_response, now);
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
