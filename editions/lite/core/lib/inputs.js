'use strict';
// Turns the broker reads captured from the brokers' own MCP tools into the snapshot blocks
// that refresh saves. No network, no logins: the captured payload is the only input.

const session = require('./session');
const norm = require('./brokers/normalize');
const snapshotLib = require('./snapshot');

const MAX_AGE_MS = 30 * 60 * 1000;

const NEEDED = {
  kite: ['get_holdings', 'get_gtts', 'get_margins'],
  kotak: ['get_holdings', 'get_limits'],
};

// What the investor must do next, per broker, in plain words.
const HINT = {
  kite: 'call the Kite MCP get_holdings, get_gtts and get_margins (get_mf_holdings, get_orders, get_trades if wanted)',
  kotak: 'call the Kotak Neo MCP get_holdings and get_limits',
};
const LOGIN_HINT = {
  kite: 'Kite wants a login: call the Kite MCP login tool and show its link; say done after',
  kotak: 'Kotak Neo wants a login: use its get_login with your UCC, scan the QR, then validate_login',
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

function cashFrom(text) {
  const j = session.asJson(text);
  if (j && typeof j === 'object') {
    for (const k of ['Net', 'net', 'available_cash', 'AvailableCash', 'cash', 'Cash']) if (k in j) return norm.num(j[k]);
  }
  const m = String(text).match(/(?:available[_ ]?cash|net)[^-\d]*(-?[\d,]+(?:\.\d+)?)/i);
  return m ? norm.num(m[1]) : null;
}

// status: live | needs_login | not_connected | stale. block is present only when live.
function pull(name, profile, now = new Date()) {
  const recs = NEEDED[name].map((s) => [s, session.read(name, s)]);
  const missing = recs.filter(([, r]) => !r).map(([s]) => s);
  if (missing.length === recs.length) return { status: 'not_connected', detail: `nothing captured in this chat or on this machine: ${HINT[name]}` };
  const login = recs.find(([, r]) => r && r.login);
  if (login) return { status: 'needs_login', detail: LOGIN_HINT[name] };
  const bad = recs.find(([, r]) => r && !r.ok);
  if (bad) return { status: 'outage', detail: `${bad[0]} failed (${bad[1].text.slice(0, 120)}). Not a login problem: do not log in again, retry later` };
  if (missing.length) return { status: 'not_connected', detail: `missing ${missing.join(', ')}: ${HINT[name]}` };
  const oldest = new Date(Math.min(...recs.map(([, r]) => new Date(r.at).getTime())));
  if (now - oldest > MAX_AGE_MS) return { status: 'stale', detail: `captured ${oldest.toISOString()}, older than 30 min: ${HINT[name]}`, as_of: oldest.toISOString() };
  const as_of = oldest.toISOString();
  const get = (s) => { const r = session.read(name, s); return r && r.ok ? session.asJson(r.text) ?? r.text : null; };
  if (name === 'kite') {
    const holdings = [...norm.kiteHoldings(get('get_holdings'), profile), ...norm.kiteMfHoldings(get('get_mf_holdings') || [])];
    const c = snapshotLib.floorCash(norm.kiteCash(get('get_margins')));
    return {
      status: 'live', as_of,
      block: { status: 'live', as_of, holdings, gtts: norm.kiteGtts(get('get_gtts')), orders: norm.kiteOrders(get('get_orders') || []), cash: c.cash, cash_note: c.note, mf_folio_count: holdings.filter((h) => h.type === 'mf').length },
    };
  }
  const raw = (s) => session.read(name, s).text;
  let holdings;
  try { holdings = holdingsFrom(raw('get_holdings'), profile); } catch (e) {
    return { status: e.code === 'KOTAK_FORMAT' ? 'format_error' : 'outage', detail: e.message.slice(0, 200) };
  }
  const c = snapshotLib.floorCash(cashFrom(raw('get_limits')));
  return { status: 'live', as_of, block: { status: 'live', as_of, holdings, gtts: [], orders: [], cash: c.cash, cash_note: c.note, mf_folio_count: holdings.filter((h) => h.type === 'mf').length } };
}

// Latest captured prices (Kite get_ltp), keyed like "NSE:SBIN".
function ltp() {
  const r = session.read('kite', 'get_ltp');
  if (!r || !r.ok) return {};
  const j = session.asJson(r.text) || {};
  const out = {};
  for (const [k, v] of Object.entries(j)) out[k] = v && typeof v === 'object' ? v.last_price : v;
  return out;
}

module.exports = { MAX_AGE_MS, NEEDED, pull, ltp, holdingsFrom, cashFrom };
