'use strict';
// Zerodha Kite via the hosted Kite MCP (https://mcp.kite.trade/mcp).
// Research R2: on this server any tool-level error on a data call means "this MCP session is
// not authorised"; only transport failures mean an outage.

const { McpHttpClient, TransportError, asJson } = require('../mcp-client');
const state = require('../state');

const KITE_URL = process.env.KITE_MCP_URL || 'https://mcp.kite.trade/mcp';

function client(opts = {}) {
  const saved = state.loadSessions().kite || {};
  return new McpHttpClient(KITE_URL, {
    sessionId: opts.fresh ? null : saved.mcp_session_id || null,
    onSession: (sid) => state.updateSession('kite', { mcp_session_id: sid, created_at: new Date().toISOString(), authorised_at: null }),
    fetchImpl: opts.fetchImpl,
    timeoutMs: opts.timeoutMs,
  });
}

function extractLink(text) {
  const m = String(text).match(/https:\/\/[^\s)\]"'<>]+/);
  return m ? m[0] : null;
}

async function status(opts = {}) {
  const c = client(opts);
  if (!c.sessionId) return { status: 'needs_login', detail: 'no session yet' };
  try {
    const r = await c.callTool('get_profile');
    if (!r.isError) {
      const p = asJson(r.text) || {};
      state.updateSession('kite', { authorised_at: new Date().toISOString() });
      return { status: 'live', user: p.user_id || p.user_name || null };
    }
    return { status: 'needs_login', detail: r.text.slice(0, 120) };
  } catch (e) {
    if (e instanceof TransportError) return { status: 'outage', detail: e.message };
    throw e;
  }
}

// Always start a fresh MCP session for a login, so the link binds to a session we own and
// persist (the 14-Oct failure was a link re-issued for a stale session).
async function login(opts = {}) {
  const c = client({ ...opts, fresh: true });
  const r = await c.callTool('login');
  const link = extractLink(r.text);
  if (!link) return { ok: false, error: 'Kite login tool returned no link', detail: r.text.slice(0, 200) };
  return { ok: true, link };
}

async function call(name, args = {}, opts = {}) {
  const c = client(opts);
  const r = await c.callTool(name, args);
  if (r.isError) {
    const e = new Error(r.text || `${name} failed`);
    e.code = 'NEEDS_LOGIN';
    throw e;
  }
  return asJson(r.text) ?? r.text;
}

async function fetchAll(opts = {}) {
  const [holdings, mf, gtts, margins, orders, trades] = await Promise.all([
    call('get_holdings', {}, opts),
    call('get_mf_holdings', {}, opts).catch(() => []),
    call('get_gtts', {}, opts),
    call('get_margins', {}, opts),
    call('get_orders', {}, opts).catch(() => []),
    call('get_trades', {}, opts).catch(() => []),
  ]);
  return { holdings, mf, gtts, margins, orders, trades };
}

async function ltp(instruments, opts = {}) {
  const r = await call('get_ltp', { instruments }, opts);
  const out = {};
  for (const [k, v] of Object.entries(r || {})) out[k] = v && typeof v === 'object' ? v.last_price : v;
  return out;
}

// Order calls used only by execute_draft (full edition).
async function placeGtt(args, opts = {}) {
  return call('place_gtt_order', args, opts);
}

async function deleteGtt(id, opts = {}) {
  return call('delete_gtt_order', { trigger_id: Number(id) }, opts);
}

module.exports = { KITE_URL, status, login, call, fetchAll, ltp, placeGtt, deleteGtt, extractLink };
