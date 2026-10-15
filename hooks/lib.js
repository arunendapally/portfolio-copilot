'use strict';
// Shared helpers for hook scripts.

const path = require('path');
const state = require('../core/lib/state');

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => { data += c; });
    process.stdin.on('end', () => resolve(data));
  });
}

// Folders that may hold drafts: the remembered working folder, then the session cwd.
function candidateFolders(input) {
  const out = [];
  if (process.env.PORTFOLIO_COPILOT_HOME) out.push(process.env.PORTFOLIO_COPILOT_HOME);
  try {
    const last = state.loadSessions().last_folder;
    if (last) out.push(last);
  } catch { /* unreadable session store: fall through to cwd */ }
  if (input && input.cwd) out.push(input.cwd);
  return [...new Set(out.map((f) => path.resolve(f)))];
}

module.exports = { readStdin, candidateFolders };
