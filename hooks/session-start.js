#!/usr/bin/env node
'use strict';
// SessionStart: inject the house rules through additionalContext (works on Windows, where
// `cat` does not exist) and resolve the file relative to this script.

const fs = require('fs');
const path = require('path');

try {
  const rules = fs.readFileSync(path.join(__dirname, '..', 'context', 'house-rules.md'), 'utf8');
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: rules } }));
} catch (err) {
  // Fail open for the session, but tell the model protection is degraded so it says so.
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: `portfolio-copilot: house rules could not be loaded (${err.message}). Tell the investor in your first reply that protection is degraded, and place no orders.`,
    },
  }));
}
