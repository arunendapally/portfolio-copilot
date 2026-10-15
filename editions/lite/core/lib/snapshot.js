'use strict';
// Consolidation, weights (always with their base), cash vs buffer, and diff vs previous snapshot.

const { round } = require('./format');

const NEG_MARGIN_FLOOR = 1000; // a small negative cash balance with no positions is a display quirk

function floorCash(cash) {
  if (cash === null || cash === undefined) return { cash: null, note: null };
  if (cash < 0 && cash > -NEG_MARGIN_FLOOR) return { cash: 0, note: `broker reported ${round(cash)}; treated as 0` };
  return { cash, note: null };
}

// fx: { USD: { rate, source, as_of } }. Returns value in INR or null when no rate is known.
function toInr(value, currency, fx) {
  if (value === null || value === undefined) return null;
  if (!currency || currency === 'INR') return value;
  const r = fx && fx[currency];
  return r ? value * r.rate : null;
}

function fundHouse(h) {
  if (h.type !== 'mf') return null;
  const name = (h.name || h.symbol || '').trim();
  const m = name.match(/^(ICICI Prudential|Aditya Birla|Mirae Asset|Parag Parikh|Motilal Oswal|Bandhan|Nippon India|Franklin|[A-Za-z]+)/i);
  return m ? m[1].toUpperCase() : null;
}

// Allocation bucket: profile mapping first, then instrument defaults.
function bucketOf(h, profile) {
  const mapped = profile.allocation.symbol_buckets[h.symbol];
  if (mapped) return mapped;
  if (h.type === 'foreign') return 'global_equity';
  const s = `${h.symbol} ${h.name || ''}`.toUpperCase();
  if (/GOLD/.test(s)) return 'gold';
  if (/SILVER/.test(s)) return 'silver';
  if (/GILT|LIQUID|BOND|DEBT|ARBITRAGE|OVERNIGHT|MONEY MARKET/.test(s)) return 'debt';
  if (/MON100|NASDAQ|MAFANG|N100|S&P|GLOBAL|US EQUITY/.test(s)) return 'global_equity';
  return 'india_equity';
}

function allHoldings(snap) {
  const out = [];
  for (const [broker, b] of Object.entries(snap.brokers || {})) {
    for (const h of b.holdings || []) out.push({ ...h, broker, value_inr: toInr(h.value, h.currency, snap.fx), pnl_inr: toInr(h.pnl, h.currency, snap.fx) });
  }
  return out;
}

function consolidate(snap, profile) {
  const holdings = allHoldings(snap);
  const brokers = {};
  let cashTotal = 0;
  const notes = [];
  for (const [name, b] of Object.entries(snap.brokers || {})) {
    const hs = holdings.filter((h) => h.broker === name);
    const cashInr = toInr(b.cash, b.cash_currency || 'INR', snap.fx);
    brokers[name] = {
      status: b.status, as_of: b.as_of,
      value: round(hs.reduce((a, h) => a + (h.value_inr || 0), 0)),
      pnl: round(hs.reduce((a, h) => a + (h.pnl_inr || 0), 0)),
      day_change: hs.some((h) => h.day_change !== null) ? round(hs.reduce((a, h) => a + (h.day_change || 0), 0)) : null,
      cash: cashInr === null ? null : round(cashInr),
      count: hs.length,
    };
    if (cashInr !== null) cashTotal += cashInr;
    if (b.cash_note) notes.push(`${name}: ${b.cash_note}`);
    if (hs.some((h) => h.value_inr === null && h.value !== null)) notes.push(`${name}: no FX rate for ${hs.find((h) => h.value_inr === null).currency}; excluded from totals`);
  }
  const invested = holdings.reduce((a, h) => a + (h.value_inr || 0), 0);
  const book = invested + cashTotal;

  const bySymbol = new Map();
  for (const h of holdings) {
    const k = h.symbol;
    const cur = bySymbol.get(k) || { symbol: k, type: h.type, value: 0, brokers: new Set() };
    cur.value += h.value_inr || 0;
    cur.brokers.add(h.broker);
    bySymbol.set(k, cur);
  }
  const directEquity = holdings.filter((h) => h.type === 'equity').reduce((a, h) => a + (h.value_inr || 0), 0);
  const positions = [...bySymbol.values()].map((p) => ({
    symbol: p.symbol, type: p.type, value: round(p.value),
    pct_of_book: book ? round((100 * p.value) / book, 2) : null,
    brokers: [...p.brokers].sort(),
  })).sort((a, b) => b.value - a.value || a.symbol.localeCompare(b.symbol));

  const sectors = {};
  for (const h of holdings.filter((x) => x.type === 'equity')) {
    const s = profile.sectors[h.symbol] || 'unclassified';
    sectors[s] = (sectors[s] || 0) + (h.value_inr || 0);
  }
  const sectorRows = Object.entries(sectors).map(([sector, v]) => ({ sector, value: round(v), pct_of_direct_equity: directEquity ? round((100 * v) / directEquity, 2) : null }))
    .sort((a, b) => b.value - a.value);

  const houses = {};
  const mfTotal = holdings.filter((h) => h.type === 'mf').reduce((a, h) => a + (h.value_inr || 0), 0);
  for (const h of holdings.filter((x) => x.type === 'mf')) {
    const fh = fundHouse(h) || 'UNKNOWN';
    houses[fh] = (houses[fh] || 0) + (h.value_inr || 0);
  }
  const houseRows = Object.entries(houses).map(([house, v]) => ({ house, value: round(v), pct_of_mf: mfTotal ? round((100 * v) / mfTotal, 2) : null }))
    .sort((a, b) => b.value - a.value);

  const cashPct = book ? (100 * cashTotal) / book : null;
  const buf = profile.cash;
  const cash = {
    total: round(cashTotal), pct_of_book: round(cashPct, 2), location: buf.buffer_location,
    target: [buf.buffer_min_pct, buf.buffer_max_pct],
    below_buffer: buf.buffer_location === 'broker' && cashPct !== null && cashPct < buf.buffer_min_pct,
    note: buf.buffer_location === 'bank' ? 'Buffer is held in the bank, outside the brokers; broker cash is deployable.' : null,
  };

  const alerts = [];
  if (cash.below_buffer) alerts.push({ level: cashPct < 1 ? 'critical' : 'warn', text: `Cash ${round(cashPct, 1)}% of book is below the ${buf.buffer_min_pct}% buffer` });
  for (const p of positions.filter((x) => x.type === 'equity' && x.pct_of_book > profile.limits.single_stock_pct)) {
    alerts.push({ level: 'warn', text: `${p.symbol} is ${p.pct_of_book}% of book (limit ${profile.limits.single_stock_pct}%)` });
  }
  for (const s of sectorRows.filter((x) => x.sector !== 'unclassified' && x.pct_of_direct_equity > profile.limits.sector_pct)) {
    alerts.push({ level: 'warn', text: `${s.sector} is ${s.pct_of_direct_equity}% of direct equity (limit ${profile.limits.sector_pct}%)` });
  }
  for (const h of houseRows.filter((x) => x.house !== 'UNKNOWN' && x.pct_of_mf > profile.limits.fund_house_pct)) {
    alerts.push({ level: 'warn', text: `${h.house} is ${h.pct_of_mf}% of the fund book (limit ${profile.limits.fund_house_pct}%)` });
  }
  for (const [name, b] of Object.entries(brokers)) {
    if (b.cash !== null && b.cash < 0) alerts.push({ level: 'critical', text: `${name} cash is negative (${b.cash})` });
  }

  const buckets = {};
  for (const h of holdings) {
    const k = bucketOf(h, profile);
    buckets[k] = (buckets[k] || 0) + (h.value_inr || 0);
  }
  buckets.cash = (buckets.cash || 0) + cashTotal;
  const targets = profile.allocation.targets || {};
  const allocation = [...new Set([...Object.keys(buckets), ...Object.keys(targets)])].map((b) => {
    const p = book ? (100 * (buckets[b] || 0)) / book : null;
    return { bucket: b, value: round(buckets[b] || 0), pct_of_book: round(p, 2), target_pct: targets[b] ?? null, drift_pp: targets[b] === undefined || p === null ? null : round(p - targets[b], 2) };
  }).sort((a, b) => b.value - a.value);

  return {
    totals: { book: round(book), invested: round(invested), pnl: round(holdings.reduce((a, h) => a + (h.pnl_inr || 0), 0)), base: 'all connected brokers, market value plus cash, INR' },
    brokers, positions, sectors: sectorRows, fund_houses: houseRows, cash, alerts, notes, allocation,
    unclassified_sector_count: holdings.filter((h) => h.type === 'equity' && !profile.sectors[h.symbol]).length,
  };
}

function qtyMap(snap) {
  const m = new Map();
  for (const [broker, b] of Object.entries((snap && snap.brokers) || {})) {
    for (const h of b.holdings || []) m.set(`${broker}:${h.symbol}`, { broker, symbol: h.symbol, qty: h.qty, ltp: h.ltp, avg: h.avg, type: h.type });
  }
  return m;
}

// Differences since the previous snapshot, with the likely cause where the data says.
function diff(prev, cur) {
  if (!prev) return { baseline: null, changes: [], folio_drops: [] };
  const a = qtyMap(prev);
  const b = qtyMap(cur);
  const changes = [];
  const keys = new Set([...a.keys(), ...b.keys()]);
  for (const k of [...keys].sort()) {
    const [broker] = k.split(':');
    if (!(cur.brokers[broker] && cur.brokers[broker].status === 'live')) continue; // only compare fresh data
    const was = a.get(k);
    const now = b.get(k);
    const before = was ? was.qty : 0;
    const after = now ? now.qty : 0;
    if (before === after) continue;
    const symbol = (now || was).symbol;
    const orders = ((cur.brokers[broker] || {}).orders || []).filter((o) => o.symbol === symbol && (o.filled_qty || 0) > 0);
    const prevGtt = ((prev.brokers[broker] || {}).gtts || []).find((g) => g.symbol === symbol && g.status === 'active');
    const curGtt = ((cur.brokers[broker] || {}).gtts || []).find((g) => prevGtt && g.id === prevGtt.id);
    let cause = 'between sessions (no matching order today)';
    if (orders.length) cause = orders.some((o) => o.via_gtt) ? 'GTT fill today' : 'manual order today';
    else if (after < before && prevGtt && (!curGtt || curGtt.status !== 'active')) cause = 'likely GTT fired (its GTT is no longer active)';
    changes.push({ broker, symbol, before, after, change: after - before, kind: !was ? 'new' : !now ? 'exited' : 'changed', cause });
  }
  const folio_drops = [];
  for (const [broker, b] of Object.entries(cur.brokers || {})) {
    const p = prev.brokers[broker];
    if (p && b.status === 'live' && p.mf_folio_count && b.mf_folio_count < p.mf_folio_count) {
      folio_drops.push({ broker, before: p.mf_folio_count, after: b.mf_folio_count, note: 'fewer fund folios than last time: could be a partial broker response or a redemption; not concluded' });
    }
  }
  const frozen = [];
  for (const [k, now] of b) {
    const was = a.get(k);
    if (was && now.type !== 'mf' && now.ltp !== null && now.ltp === now.avg && was.ltp === was.avg) frozen.push(now.symbol);
  }
  return { baseline: prev.taken_at, changes, folio_drops, frozen_prices: frozen };
}

module.exports = { consolidate, diff, floorCash, toInr, allHoldings, fundHouse };
