'use strict';
// Broker reads captured by the PostToolUse hook from the brokers' own MCP tools. The hook and
// the pc script run on the same machine, so the model never retypes broker numbers.

const path = require('path');
const { configDir, readJson, writeJson } = require('./state');
const toolmap = require('./brokers/toolmap');

// Session expired or not authorised: the broker wants a login, which is not an outage.
// "failed to execute" is what the Kite MCP returns for a read while logged out.
const LOGIN_RE = /invalid session|session (has )?expired|please log ?in|not (yet )?authori[sz]ed|missing authentication|login required|failed to execute/i;

// Tools changed name: the broker server answers, but not to this name. Not a login, not an outage.
const TOOLS_CHANGED_RE = /unknown tool|tool [^\n]{0,80} not found|no such tool|method not found/i;

// Capabilities worth keeping; everything else (writes, sessions, lookups) is not captured.
const CAPTURED = new Set(['holdings', 'mf', 'gtts', 'margins', 'positions', 'orders', 'trades', 'ltp', 'balances', 'summary']);

function sourceOf(toolName) {
  return toolmap.resolve(toolName, {}).broker;
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

// A read made with a page size or an offset may hold part of the list (issue #31). The broker's
// own pagination decides when it is there; the call's arguments decide when it is not.
function pagedBy(args) {
  if (!args || typeof args !== 'object') return null;
  if (Number(args.limit) > 0) return `limit=${args.limit}`;
  if (Number(args.from) > 0) return `from=${args.from}`;
  return null;
}

function partialOf(json, args) {
  const p = json && typeof json === 'object' && !Array.isArray(json) ? json.pagination : null;
  if (p && typeof p === 'object') {
    if (p.has_more) return `a page of ${p.returned ?? '?'} of ${p.total ?? '?'} rows, more rows remain`;
    if (Number(p.from) > 0) return `from=${p.from}`;
    return null;
  }
  return pagedBy(args);
}

// Prices arrive flat ({"NSE:X": {...}}) or wrapped ({data: {...}, meta}).
function priceMap(json) {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
  return json.data && typeof json.data === 'object' && !Array.isArray(json.data) ? json.data : json;
}

function record(toolName, resp, now = new Date(), toolInput = null) {
  const args = toolInput && typeof toolInput === 'object' ? toolInput : {};
  const r = toolmap.resolve(toolName, args);
  // Kite's session status is kept too: connect reads it to decide between a read and a login.
  const sessionStatus = r.kind === 'session' && r.mode === 'status';
  if (!r.broker || !(sessionStatus || (r.kind === 'read' && CAPTURED.has(r.cap)))) return null;
  // Only the full holdings view carries prices and averages.
  if (r.cap === 'holdings' && args.type && args.type !== 'full') return null;
  const text = textOf(resp);
  const head = text.slice(0, 400);
  const toolsChanged = TOOLS_CHANGED_RE.test(head);
  const login = !toolsChanged && LOGIN_RE.test(head);
  const failed = (resp && resp.isError === true) || login || toolsChanged;
  const rec = { tool: toolName, mode: r.mode, at: now.toISOString(), ok: !failed, login, tools_changed: toolsChanged, text, partial: false };
  if (!failed) {
    const paged = partialOf(asJson(text), args);
    if (paged) Object.assign(rec, { paged, partial: true });
  }
  // Prices are asked for in pieces (index, a few symbols): keep what earlier calls returned.
  if (r.cap === 'ltp' && !failed) {
    const before = read(r.broker, 'ltp');
    const a = before && before.ok ? priceMap(asJson(before.text)) : null;
    const b = priceMap(asJson(text));
    if (b) rec.text = JSON.stringify({ ...(a || {}), ...b });
  }
  writeJson(path.join(dir(r.broker), `${r.cap}.json`), rec, 0o600);
  return { source: r.broker, cap: r.cap, tool: r.tool, ok: rec.ok };
}

// A read made by the local engine (spec 002 US7): the same record the hook writes, so everything
// downstream is unchanged. tool is local:<broker>:<endpoint>.
function saveLocal(broker, cap, text, { ok = true, partial = false, tool, now = new Date() } = {}) {
  const rec = { tool: tool || `local:${broker}:${cap}`, mode: null, at: now.toISOString(), ok, login: false, tools_changed: false, text, partial };
  writeJson(path.join(dir(broker), `${cap}.json`), rec, 0o600);
  return rec;
}

function read(source, cap) {
  return readJson(path.join(dir(source), `${cap}.json`), null);
}

module.exports = { LOGIN_RE, TOOLS_CHANGED_RE, CAPTURED, sourceOf, textOf, asJson, record, read, saveLocal };
