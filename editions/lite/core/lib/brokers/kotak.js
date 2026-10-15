'use strict';
// Kotak Neo via its hosted MCP. Stateless server: every call carries the sessionid that
// get_login minted. The QR scan binds to that exact id, so we store it and validate only it.

const fs = require('fs');
const path = require('path');
const { McpHttpClient, TransportError, asJson } = require('../mcp-client');
const state = require('../state');
const { kotakHoldings, num } = require('./normalize');

const KOTAK_URL = process.env.KOTAK_MCP_URL || 'https://neo.kotaksecurities.com/mcp-server/mcp';

function client(opts = {}) {
  return new McpHttpClient(KOTAK_URL, { fetchImpl: opts.fetchImpl, timeoutMs: opts.timeoutMs });
}

function extractSessionId(text) {
  const j = asJson(text);
  if (j && (j.sessionid || j.session_id || j.sessionId)) return j.sessionid || j.session_id || j.sessionId;
  const m = String(text).match(/session_?id["'\s:=]+([A-Za-z0-9._-]{8,})/i);
  return m ? m[1] : null;
}

function extractLink(text) {
  const m = String(text).match(/https:\/\/[^\s)\]"'<>]+/);
  return m ? m[0] : null;
}

async function status(opts = {}) {
  const s = state.loadSessions().kotak;
  if (!s || !s.sessionid) return { status: 'needs_login', detail: 'no session yet' };
  try {
    const r = await client(opts).callTool('get_limits', { sessionid: s.sessionid });
    if (!r.isError && !/expired|invalid|missing authentication|log ?in/i.test(r.text)) return { status: 'live' };
    return { status: 'needs_login', detail: r.text.slice(0, 120) };
  } catch (e) {
    if (e instanceof TransportError) return { status: 'outage', detail: e.message };
    throw e;
  }
}

async function loginStart(ucc, opts = {}) {
  if (!ucc) return { ok: false, error: 'Kotak needs your UCC (client code). Save it with profile_update brokers.kotak.ucc.' };
  const r = await client(opts).callTool('get_login', { ucc });
  const sessionid = extractSessionId(r.text);
  const link = extractLink(r.text);
  if (r.isError || !sessionid) return { ok: false, error: 'Kotak get_login failed', detail: r.text.slice(0, 200) };
  state.updateSession('kotak', { sessionid, ucc, created_at: new Date().toISOString(), validated_at: null });
  return { ok: true, link, instructions: 'Open the link, then in the Kotak Neo app go to Profile > Web Login and scan the QR. Say "done" when finished.' };
}

async function loginValidate(opts = {}) {
  const s = state.loadSessions().kotak;
  if (!s || !s.sessionid) return { ok: false, error: 'No Kotak login in progress; start one first.' };
  const r = await client(opts).callTool('validate_login', { sessionid: s.sessionid });
  if (r.isError || !/success/i.test(r.text)) return { ok: false, error: 'Kotak validation failed', detail: r.text.slice(0, 200) };
  state.updateSession('kotak', { validated_at: new Date().toISOString() });
  return { ok: true };
}

async function call(name, opts = {}) {
  const s = state.loadSessions().kotak || {};
  const r = await client(opts).callTool(name, { sessionid: s.sessionid });
  if (r.isError || /session expired|missing authentication/i.test(r.text)) {
    const e = new Error(r.text || `${name} failed`);
    e.code = 'NEEDS_LOGIN';
    throw e;
  }
  return r.text;
}

function saveRaw(name, text) {
  try {
    const dir = path.join(state.configDir(), 'raw');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `kotak-${name}.txt`), text, { mode: 0o600 });
  } catch { /* debugging aid only */ }
}

// Accept either delimited text or a JSON array of row objects.
function holdingsFrom(text, profile) {
  // Kotak's hosted server returns the CSV as a JSON string literal ("...\r\n...").
  if (/^\s*"/.test(text)) { try { const s = JSON.parse(text); if (typeof s === 'string') text = s; } catch { /* not a string literal */ } }
  const j = asJson(text);
  const arr = Array.isArray(j) ? j : j && Array.isArray(j.data) ? j.data : null;
  if (arr && arr.length && typeof arr[0] === 'object') {
    const headers = Object.keys(arr[0]);
    const csv = [headers.join('|'), ...arr.map((o) => headers.map((h) => String(o[h] ?? '').replace(/\|/g, ' ')).join('|'))].join('\n');
    return kotakHoldings(csv, profile);
  }
  const inner = j && typeof j === 'object' && typeof j.data === 'string' ? j.data : text;
  return kotakHoldings(inner, profile);
}

function cashFrom(text) {
  const j = asJson(text);
  if (j && typeof j === 'object') {
    for (const k of ['Net', 'net', 'available_cash', 'AvailableCash', 'cash', 'Cash']) if (k in j) return num(j[k]);
  }
  const m = String(text).match(/(?:available[_ ]?cash|net)[^-\d]*(-?[\d,]+(?:\.\d+)?)/i);
  return m ? num(m[1]) : null;
}

async function fetchAll(profile, opts = {}) {
  const [holdingsText, limitsText] = await Promise.all([call('get_holdings', opts), call('get_limits', opts)]);
  saveRaw('holdings', holdingsText);
  return { holdings: holdingsFrom(holdingsText, profile), cash: cashFrom(limitsText) };
}

module.exports = { KOTAK_URL, status, loginStart, loginValidate, fetchAll, holdingsFrom, cashFrom, extractSessionId };
