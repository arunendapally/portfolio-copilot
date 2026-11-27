'use strict';
// Dashboard export (spec 002 T083, contracts/pc-commands.md "export"): the latest snapshot in the
// shape the investor's dashboard reads. Technicals the engine has not computed are null, never
// estimated.

const fs = require('fs');
const path = require('path');
const snapshotLib = require('./snapshot');
const gtt = require('./gtt');
const marksLib = require('./marks');
const { istDate, istStamp } = require('./format');
const setupsLib = require('./setups');
const technicals = require('./technicals');
const inputs = require('./inputs');

const TECH = ['dma50', 'dma200', 'rsi', 'sup20', 'hi52'];
// The dashboard's positions file shows labels, not the engine's codes; key stays the engine id.
const BROKER = { kite: 'Kite', kotak: 'Kotak Neo', ibkr: 'IBKR' };
const KIND = { mf: 'Fund', etf: 'ETF', equity: 'Stock' };
const BUCKET = { india_equity: 'India equity', global_equity: 'Global', debt: 'Debt', gold: 'Gold', silver: 'Silver', cash: 'Cash' };
const label = (map, v) => map[v] || String(v || '').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
const when = (iso) => istStamp(new Date(iso));

function rows(snap, prev, profile, marks) {
  const c = snapshotLib.consolidate(snap, profile);
  const audit = snap.brokers.kite ? gtt.audit(snap, prev, profile, { marks }) : { rows: [] };
  const byGtt = new Map(audit.rows.map((r) => [r.symbol, r]));
  const prevPrice = new Map();
  for (const [b, x] of Object.entries((prev && prev.brokers) || {})) for (const h of x.holdings || []) prevPrice.set(`${b}:${h.symbol}`, h.ltp);
  const out = [];
  for (const [broker, b] of Object.entries(snap.brokers || {})) {
    for (const h of b.holdings || []) {
      const g = broker === 'kite' ? byGtt.get(h.symbol) : null;
      const tech = (snap.technicals && snap.technicals[h.symbol]) || {};
      const fx = h.currency && h.currency !== 'INR' ? (snap.fx && snap.fx[h.currency] ? snap.fx[h.currency].rate : null) : 1;
      out.push({
        key: `${broker}:${h.symbol}`, broker: label(BROKER, broker), sym: h.symbol, name: h.name || null, type: h.type === 'mf' ? 'Mutual fund' : 'Equity',
        kind: label(KIND, h.type),
        bucket: label(BUCKET, snapshotLib.bucketOf(h, profile)), core: (profile.classes && profile.classes[h.symbol]) ? profile.classes[h.symbol] === 'core' : h.type !== 'equity',
        qty: h.qty, avg: h.avg ?? null, ltp: h.ltp ?? null, prevClose: h.prev_close ?? prevPrice.get(`${broker}:${h.symbol}`) ?? null, fx,
        gttQty: g ? (g.issues.some((i) => i.code === 'no_gtt') ? 0 : g.qty - ((g.issues.find((i) => i.code === 'qty_short') || {}).gap || 0)) : null,
        gttStop: g ? g.stop : null, gttTarget: g ? g.target : null,
        settling: h.day_qty || 0,
        setup: setupsLib.classify(tech, h.ltp), rr: setupsLib.rr(tech, h.ltp),
        ...Object.fromEntries(TECH.map((k) => [k, typeof tech[k] === 'number' ? tech[k] : null])),
        asof: when(h.price_as_of || b.as_of || snap.taken_at),
        lock: marks && marks.symbols[h.symbol] ? marks.symbols[h.symbol].stage : null,
      });
    }
  }
  const cash = Object.entries(c.brokers).map(([broker, x]) => ({ broker: label(BROKER, broker), cash: x.cash, asof: when(snap.brokers[broker].as_of || snap.taken_at), status: snap.brokers[broker].status }));
  return { positions: out, cash, totals: c.totals };
}

function write(folder, out, snap, prev, profile) {
  const date = istDate(new Date(snap.taken_at));
  const r = rows(snap, prev, profile, marksLib.load(folder));
  fs.mkdirSync(out, { recursive: true });
  // Watchlist names (profile.watchlist) with their setups; a price the snapshot lacks comes from a captured quote, else null.
  const held = new Map();
  for (const b of Object.values(snap.brokers || {})) for (const h of b.holdings || []) if (typeof h.ltp === 'number' && !held.has(h.symbol)) held.set(h.symbol, h.ltp);
  const quotes = inputs.ltp();
  const techs = technicals.forSnapshot(technicals.load(folder));
  const w = profile.watchlist || { symbols: [], screens: [] };
  const watch = {
    names: w.symbols.map((x) => {
      const ltp = held.has(x.symbol) ? held.get(x.symbol) : typeof quotes[`NSE:${x.symbol}`] === 'number' ? quotes[`NSE:${x.symbol}`] : null;
      return { ...setupsLib.rows([{ symbol: x.symbol, ltp }], techs)[0], added: x.added, source: x.source, note: x.note || null };
    }),
    screens: w.screens.map((x) => ({ name: x.name, last_run: x.last_run || null, results: (x.last_results || []).length })),
  };
  const files = [[`positions-${date}.json`, r.positions], [`cash-${date}.json`, { cash: r.cash, totals: r.totals }], [`watchlist-${date}.json`, watch]].map(([name, data]) => {
    const p = path.join(out, name);
    const text = JSON.stringify(data, null, 2);
    fs.writeFileSync(p, text);
    if (fs.readFileSync(p, 'utf8') !== text) throw new Error(`export write to ${p} did not stick`);
    return p;
  });
  return { files, positions: r.positions.length };
}

module.exports = { rows, write, TECH };
