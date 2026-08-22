#!/usr/bin/env node
/*
 * portfolio-copilot SessionStart hook.
 * Injects context/house-rules.md into the session context.
 *
 * Why this exists as a Node script instead of `cat`:
 *  - Cross-platform: `cat` is not a native Windows command (cmd.exe uses `type`),
 *    so the old `cat ${CLAUDE_PLUGIN_ROOT}/...` hook produced no output on Windows.
 *  - Reliable injection: emits the documented SessionStart `additionalContext`
 *    channel (JSON) rather than relying on plain stdout, which is honored in both
 *    interactive and headless (`claude -p`) sessions.
 *  - Path-safe: resolves the file relative to this script (__dirname), so it does
 *    not depend on the CLAUDE_PLUGIN_ROOT env var being present at runtime.
 */
const fs = require('fs');
const path = require('path');

try {
  const file = path.join(__dirname, '..', 'context', 'house-rules.md');
  const rules = fs.readFileSync(file, 'utf8');
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: rules
    }
  }));
} catch (err) {
  // Fail open (don't block the session) but make the failure visible for debugging.
  process.stderr.write('[portfolio-copilot] SessionStart hook could not load house-rules.md: ' + err.message + '\n');
  process.exit(0);
}
