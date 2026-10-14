'use strict';
// Convert broker payloads into the normalized shapes in data-model.md.

const ETF_RE = /(BEES|ETF|IETF)$|^MON100$/;

function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[₹,\s]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function isEtf(symbol, profile) {
  const list = (profile && profile.gtt_policy && profile.gtt_policy.etf_symbols) || [];
  return list.map((s) => s.toUpperCase()).includes(symbol.toUpperCase()) || ETF_RE.test(symbol.toUpperCase());
}

// Kite list payloads come back as an array, or wrapped with pagination metadata.
function items(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === 'object') {
    for (const k of ['data', 'items', 'holdings', 'results']) if (Array.isArray(payload[k])) return payload[k];
  }
  return [];
}

function kiteHoldings(payload, profile) {
  return items(payload).map((h) => {
    const symbol = String(h.tradingsymbol || '').toUpperCase();
    const qty = (num(h.quantity) || 0) + (num(h.t1_quantity) || 0);
    const ltp = num(h.last_price);
    const avg = num(h.average_price);
    return {
      broker: 'kite', symbol, exchange: h.exchange || 'NSE', isin: h.isin || null,
      type: isEtf(symbol, profile) ? 'etf' : 'equity',
      qty, avg, ltp,
      value: ltp !== null ? qty * ltp : null,
      pnl: ltp !== null && avg !== null ? qty * (ltp - avg) : num(h.pnl),
      day_change: num(h.day_change) !== null ? num(h.day_change) * qty : null,
      sellable_qty: num(h.quantity),
      currency: 'INR',
    };
  }).filter((h) => h.qty > 0);
}

function kiteMfHoldings(payload) {
  return items(payload).map((m) => {
    const qty = num(m.quantity) || 0;
    const ltp = num(m.last_price);
    const avg = num(m.average_price);
    return {
      broker: 'kite', symbol: String(m.tradingsymbol || m.fund || '').toUpperCase(), name: m.fund || null,
      exchange: 'MF', isin: m.tradingsymbol || null, type: 'mf', folio: m.folio || null,
      qty, avg, ltp,
      value: ltp !== null ? qty * ltp : null,
      pnl: ltp !== null && avg !== null ? qty * (ltp - avg) : num(m.pnl),
      day_change: null, currency: 'INR',
    };
  }).filter((m) => m.qty > 0);
}

function kiteGtts(payload) {
  return items(payload).map((g) => {
    const c = g.condition || {};
    const orders = g.orders || [];
    return {
      id: g.id, broker: 'kite',
      symbol: String(c.tradingsymbol || (orders[0] && orders[0].tradingsymbol) || '').toUpperCase(),
      exchange: c.exchange || 'NSE',
      type: g.type === 'two-leg' ? 'two-leg' : 'single',
      status: g.status || 'active',
      triggers: (c.trigger_values || []).map(num),
      legs: orders.map((o) => ({ side: o.transaction_type, qty: num(o.quantity), price: num(o.price) })),
      created_price: num(c.last_price),
      created_at: g.created_at || null,
      reason: (g.meta && (g.meta.rejection_reason || g.meta.reason)) || null,
    };
  });
}

function kiteCash(payload) {
  const eq = payload && payload.equity;
  if (!eq) return null;
  const net = num(eq.net);
  if (net !== null) return net;
  return eq.available ? num(eq.available.live_balance) ?? num(eq.available.cash) : null;
}

function kiteOrders(payload) {
  return items(payload).map((o) => ({
    id: o.order_id, symbol: String(o.tradingsymbol || '').toUpperCase(), exchange: o.exchange,
    side: o.transaction_type, qty: num(o.quantity), filled_qty: num(o.filled_quantity),
    price: num(o.average_price) || num(o.price), status: o.status, at: o.order_timestamp || null,
    via_gtt: !!((o.meta && (o.meta.gtt || o.meta.gttp)) || /gtt/i.test(o.tag || '') || (o.tags || []).some((t) => /gtt/i.test(t))),
  }));
}

// ---- Kotak: delimited text with undocumented headers --------------------------------

const KOTAK_ALIASES = {
  symbol: ['symbol', 'tradingsymbol', 'trading symbol', 'displaysymbol', 'display symbol', 'scrip', 'scrip name', 'instrument', 'name', 'scheme name', 'fund name'],
  qty: ['quantity', 'qty', 'shares owned', 'holding quantity', 'units', 'total qty', 'sellable quantity'],
  avg: ['average price', 'avg price', 'averageprice', 'avg cost', 'buy avg', 'average cost'],
  ltp: ['ltp', 'last price', 'closing price', 'close price', 'current price', 'nav', 'market price'],
  value: ['market value', 'current value', 'mkt value', 'value', 'holding value', 'mktvalue'],
  cost: ['cost', 'invested value', 'holding cost', 'total cost', 'invested amount', 'investment value'],
  type: ['instrument type', 'instrumenttype', 'segment', 'type', 'asset type', 'product'],
  exchange: ['exchange', 'exchange segment', 'exch'],
  isin: ['isin'],
};

function splitLine(line, delim) {
  const out = [];
  let cur = '';
  let q = false;
  for (const ch of line) {
    if (ch === '"') q = !q;
    else if (ch === delim && !q) { out.push(cur.trim()); cur = ''; }
    else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

function parseDelimited(text) {
  const lines = String(text).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const headerIdx = lines.findIndex((l) => (l.match(/[,;|]/g) || []).length >= 2);
  if (headerIdx < 0) return { headers: [], rows: [] };
  const counts = { ',': 0, ';': 0, '|': 0 };
  for (const ch of lines[headerIdx]) if (ch in counts) counts[ch]++;
  const delim = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  const headers = splitLine(lines[headerIdx], delim).map((h) => h.replace(/^"|"$/g, ''));
  const rows = lines.slice(headerIdx + 1).map((l) => splitLine(l, delim)).filter((r) => r.length === headers.length);
  return { headers, rows };
}

function mapHeaders(headers) {
  const lower = headers.map((h) => h.toLowerCase().trim());
  const idx = {};
  for (const [key, names] of Object.entries(KOTAK_ALIASES)) {
    const i = lower.findIndex((h) => names.includes(h));
    if (i >= 0) idx[key] = i;
  }
  return idx;
}

function kotakHoldings(text, profile) {
  const { headers, rows } = parseDelimited(text);
  const idx = mapHeaders(headers);
  if (idx.symbol === undefined || idx.qty === undefined || (idx.ltp === undefined && idx.value === undefined)) {
    const err = new Error(`Unrecognised Kotak holdings format. Headers: ${headers.join(', ') || '(none)'}`);
    err.code = 'KOTAK_FORMAT';
    throw err;
  }
  return rows.map((r) => {
    const symbol = String(r[idx.symbol]).toUpperCase();
    const qty = num(r[idx.qty]) || 0;
    const value = idx.value !== undefined ? num(r[idx.value]) : null;
    const ltp = idx.ltp !== undefined ? num(r[idx.ltp]) : (value !== null && qty ? value / qty : null);
    const avg = idx.avg !== undefined ? num(r[idx.avg]) : (idx.cost !== undefined && qty ? num(r[idx.cost]) / qty : null);
    const typeRaw = idx.type !== undefined ? String(r[idx.type]).toLowerCase() : '';
    const type = /mf|mutual|fund/.test(typeRaw) ? 'mf' : isEtf(symbol, profile) ? 'etf' : /etf/.test(typeRaw) ? 'etf' : 'equity';
    const v = value !== null ? value : ltp !== null ? qty * ltp : null;
    return {
      broker: 'kotak', symbol, exchange: idx.exchange !== undefined ? r[idx.exchange] : type === 'mf' ? 'MF' : 'NSE',
      isin: idx.isin !== undefined ? r[idx.isin] : null, type, qty, avg, ltp, value: v,
      pnl: v !== null && avg !== null ? v - qty * avg : null, day_change: null, currency: 'INR',
    };
  }).filter((h) => h.qty > 0);
}

module.exports = { num, isEtf, items, kiteHoldings, kiteMfHoldings, kiteGtts, kiteCash, kiteOrders, parseDelimited, kotakHoldings };
