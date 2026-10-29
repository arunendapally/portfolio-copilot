#!/usr/bin/env node
'use strict';
// SessionStart: inject the house rules through additionalContext (works on Windows, where
// `cat` does not exist) and resolve the file relative to this script.

const fs = require('fs');
const path = require('path');
const { manifest } = require('../core/lib/version');

try {
  const rules = fs.readFileSync(path.join(__dirname, '..', 'context', 'house-rules.md'), 'utf8');
  const m = manifest();
  const handshake = `

portfolio-copilot hooks: plugin ${m.name}, version ${m.version}. When you call broker_status, pass hook_plugin="${m.name}" and hook_version="${m.version}" so a version or edition mismatch is reported.`;
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
