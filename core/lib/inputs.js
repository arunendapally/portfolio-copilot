'use strict';
// Turns the broker reads captured from the brokers' own MCP tools into the snapshot blocks
// that refresh saves. No network, no logins: the captured payload is the only input.

const session = require('./session');
const norm = require('./brokers/normalize');
const snapshotLib = require('./snapshot');

const MAX_AGE_MS = 30 * 60 * 1000;

const toolmap = require('./brokers/toolmap');

// Capabilities a broker must have captured before its block is live; optional ones join when present.
const NEEDED = { kite: ['holdings', 'gtts', 'margins'], kotak: ['holdings', 'margins'] };
const OPTIONAL = { kite: ['mf', 'orders'], kotak: [] };

const MCP_NAME = { kite: 'Kite', kotak: 'Kotak Neo' };

// The Kite generation in use, from the tools that were captured; newest when nothing was.
function genOf(name) {
  const tools = [...NEEDED[name], ...OPTIONAL[name]].map((c) => session.read(name, c)).filter(Boolean).map((r) => r.tool);
  return toolmap.generation(name, tools);
}

// The exact reads to make, named by the tool map, never typed here.
function callsFor(name, caps) {
  const calls = toolmap.readCalls(name, genOf(name));
  return calls.filter((c) => (caps ? caps.includes(c.cap) : c.required)).map(toolmap.show).join(', ');
}
function hint(name, caps) {
  return `call the ${MCP_NAME[name]} MCP: ${callsFor(name, caps)}`;
}
const LOGIN_HINT = {
  kite: 'Kite wants a login: call the Kite MCP login tool (session status on the newer tools) and show its link; say done after',
  kotak: 'Kotak Neo wants a login: start the Kotak Neo QR login with your UCC, scan the QR, then validate it',
};

// Kotak's hosted server returns the CSV as a JSON string literal, or rows as objects.
function holdingsFrom(text, profile) {
  if (/^\s*"/.test(text)) { try { const s = JSON.parse(text); if (typeof s === 'string') text = s; } catch { /* not a string literal */ } }
  const j = session.asJson(text);
  const arr = Array.isArray(j) ? j : j && Array.isArray(j.data) ? j.data : null;
  if (arr && arr.length && typeof arr[0] === 'object') {
    const headers = Object.keys(arr[0]);
    const csv = [headers.join('|'), ...arr.map((o) => headers.map((h) => String(o[h] ?? '').replace(/\|/g, ' ')).join('|'))].join('\n');
    return norm.kotakHoldings(csv, profile);
  }
  const inner = j && typeof j === 'object' && typeof j.data === 'string' ? j.data : text;
  return norm.kotakHoldings(inner, profile);
}

// Kotak limits: a CSV (often inside a JSON array or string), or an object with a net figure.
function cashFrom(text) {
  let t = text;
  let j = session.asJson(t);
  if (Array.isArray(j) && j.every((x) => typeof x === 'string')) { t = j.join('\n'); j = null; }
  else if (typeof j === 'string') { t = j; j = null; }
  if (j && typeof j === 'object' && !Array.isArray(j)) {
    for (const k of ['Net', 'net', 'available_cash', 'AvailableCash', 'cash', 'Cash']) if (k in j) return norm.num(j[k]);
  }
  const { headers, rows } = norm.parseDelimited(t);
  if (headers.length && rows.length) {
    const lower = headers.map((h) => h.toLowerCase().trim());
    for (const want of ['cash margin', 'available margin', 'net', 'available cash']) {
      const i = lower.indexOf(want);
      if (i >= 0) { const v = norm.num(String(rows[0][i]).replace(/^"|"$/g, '')); if (v !== null) return v; }
    }
  }
  const m = String(t).match(/(?:available[_ ]?cash|net)[^-\d]*(-?[\d,]+(?:\.\d+)?)/i);
  return m ? norm.num(m[1]) : null;
}

// status: live | needs_login | tools_changed | outage | format_error | not_connected | stale.
// block is present only when live.
function pull(name, profile, now = new Date()) {
  const recs = NEEDED[name].map((s) => [s, session.read(name, s)]);
  const missing = recs.filter(([, r]) => !r).map(([s]) => s);
  if (missing.length === recs.length) return { status: 'not_connected', detail: `nothing captured in this chat or on this machine: ${hint(name)}` };
  const changed = recs.filter(([, r]) => r && r.tools_changed);
  if (changed.length) return { status: 'tools_changed', detail: `the ${MCP_NAME[name]} MCP no longer has ${changed.map(([, r]) => r.tool.split('__').pop()).join(', ')}: its tools were renamed. Run the doctor command for the calls to make now` };
  const login = recs.find(([, r]) => r && r.login);
  if (login) return { status: 'needs_login', detail: LOGIN_HINT[name] };
  const bad = recs.find(([, r]) => r && !r.ok);
  if (bad) return { status: 'outage', detail: `${bad[0]} failed (${bad[1].text.slice(0, 120)}). Not a login problem: do not log in again, retry later` };
  if (missing.length) return { status: 'not_connected', detail: `missing ${missing.join(', ')}: ${hint(name, missing)}` };
  const oldest = new Date(Math.min(...recs.map(([, r]) => new Date(r.at).getTime())));
  // Name the exact reads to repeat, not all of them (issue #31).
  const optional = OPTIONAL[name].map((s) => [s, session.read(name, s)]).filter(([, r]) => r);
  const paged = [...recs, ...optional].filter(([, r]) => r.partial);
  if (paged.length) return { status: 'stale', detail: `${paged.map(([, r]) => `${r.tool.split('__').pop()} was read with ${r.paged}, so it holds part of the list`).join('; ')}. ${hint(name, paged.map(([s]) => s))}`, as_of: oldest.toISOString() };
  const old = recs.filter(([, r]) => now - new Date(r.at) > MAX_AGE_MS);
  if (old.length) return { status: 'stale', detail: `${old.map(([s]) => s).join(' and ')} captured ${new Date(Math.min(...old.map(([, r]) => new Date(r.at).getTime()))).toISOString()}, older than 30 min: ${hint(name, old.map(([s]) => s))}`, as_of: oldest.toISOString() };
  const as_of = oldest.toISOString();
  const get = (s) => { const r = session.read(name, s); return r && r.ok ? session.asJson(r.text) ?? r.text : null; };
  if (name === 'kite') {
    const holdings = [...norm.kiteHoldings(get('holdings'), profile), ...norm.kiteMfHoldings(get('mf') || [])];
    const c = snapshotLib.floorCash(norm.kiteCash(get('margins')));
    return {
      status: 'live', as_of,
      block: { status: 'live', as_of, holdings, gtts: norm.kiteGtts(get('gtts')), orders: norm.kiteOrders(get('orders') || []), cash: c.cash, cash_note: c.note, mf_folio_count: holdings.filter((h) => h.type === 'mf').length },
    };
  }
  const raw = (s) => session.read(name, s).text;
  let holdings;
  try { holdings = holdingsFrom(raw('holdings'), profile); } catch (e) {
    return { status: e.code === 'KOTAK_FORMAT' ? 'format_error' : 'outage', detail: e.message.slice(0, 200) };
  }
  const cash = cashFrom(raw('margins'));
  if (cash === null) return { status: 'format_error', detail: `Kotak cash could not be read from the limits reply (${raw('margins').slice(0, 80)}). Not a login problem; the reply format changed` };
  const c = snapshotLib.floorCash(cash);
  return { status: 'live', as_of, block: { status: 'live', as_of, holdings, gtts: [], orders: [], cash: c.cash, cash_note: c.note, mf_folio_count: holdings.filter((h) => h.type === 'mf').length } };
}

// Latest captured Kite prices, keyed like "NSE:SBIN".
function ltp() {
  const r = session.read('kite', 'ltp');
  if (!r || !r.ok) return {};
  const j = session.asJson(r.text) || {};
  const out = {};
  for (const [k, v] of Object.entries(j)) out[k] = v && typeof v === 'object' ? v.last_price : v;
  return out;
}

module.exports = { MAX_AGE_MS, NEEDED, OPTIONAL, pull, ltp, holdingsFrom, cashFrom, hint, genOf };
