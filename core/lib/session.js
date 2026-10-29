'use strict';
// Broker reads captured by the PostToolUse hook from the brokers' own MCP tools. The hook and
// the pc script run on the same machine, so the model never retypes broker numbers.

const path = require('path');
const { configDir, readJson, writeJson } = require('./state');

// Session expired or not authorised: the broker wants a login, which is not an outage.
const LOGIN_RE = /invalid session|session (has )?expired|please log ?in|not (yet )?authori[sz]ed|missing authentication|login required/i;

function sourceOf(toolName) {
  const n = String(toolName).toLowerCase();
  if (/kite/.test(n)) return 'kite';
  if (/kotak/.test(n)) return 'kotak';
  if (/interactive_brokers|ibkr/.test(n)) return 'ibkr';
  return null;
}

function suffixOf(toolName) {
  return String(toolName).split('__').pop();
}

// MCP results arrive as text, an array of content blocks, or {content: [...]}.
function textOf(resp) {
  if (resp === null || resp === undefined) return '';
  if (typeof resp === 'string') return resp;
  const blocks = Array.isArray(resp) ? resp : Array.isArray(resp.content) ? resp.content : null;
  if (blocks) return blocks.map((b) => (typeof b === 'string' ? b : b && typeof b.text === 'string' ? b.text : '')).filter(Boolean).join('\n');
  if (typeof resp.text === 'string') return resp.text;
  return JSON.stringify(resp);
}

function asJson(text) {
  try { return JSON.parse(text); } catch { return null; }
}

function dir(source) {
  return path.join(configDir(), 'captured', source);
}

function record(toolName, resp, now = new Date()) {
  const source = sourceOf(toolName);
  if (!source) return null;
  const text = textOf(resp);
  const failed = (resp && resp.isError === true) || LOGIN_RE.test(text.slice(0, 400));
  const rec = { tool: toolName, at: now.toISOString(), ok: !failed, login: LOGIN_RE.test(text.slice(0, 400)), text };
  // Prices are asked for in pieces (index, a few symbols): keep what earlier calls returned.
  if (suffixOf(toolName) === 'get_ltp' && !failed) {
    const before = read(source, 'get_ltp');
    const a = before && before.ok ? asJson(before.text) : null;
    const b = asJson(text);
    if (a && b && typeof a === 'object' && typeof b === 'object') rec.text = JSON.stringify({ ...a, ...b });
  }
  writeJson(path.join(dir(source), `${suffixOf(toolName)}.json`), rec, 0o600);
  return { source, suffix: suffixOf(toolName), ok: rec.ok };
}

function read(source, suffix) {
  return readJson(path.join(dir(source), `${suffix}.json`), null);
}

module.exports = { LOGIN_RE, sourceOf, suffixOf, textOf, asJson, record, read };
