'use strict';
// The installed plugin's name and version, read from its own manifest.

const fs = require('fs');
const path = require('path');

function manifest() {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '.claude-plugin', 'plugin.json'), 'utf8'));
  } catch {
    return { name: 'portfolio-copilot', version: 'unknown' };
  }
}

// Compares what the session's hooks report with this server. Returns a warning or null.
function mismatch(hook, server = manifest()) {
  if (!hook || !hook.version) return null;
  const parts = [];
  if (hook.plugin && hook.plugin !== server.name) parts.push(`the chat loaded hooks from ${hook.plugin} but this server is ${server.name}: remove one of them`);
  if (hook.version !== server.version) parts.push(`hooks are v${hook.version} but the server is v${server.version}: start a new chat to use v${server.version}`);
  return parts.length ? `⚠️ Version mismatch: ${parts.join('; ')}. Do not draft or approve anything until this is fixed.` : null;
}

module.exports = { manifest, mismatch };
