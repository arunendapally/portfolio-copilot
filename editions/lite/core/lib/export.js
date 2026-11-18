'use strict';
// Dashboard export (spec 002 T083, contracts/pc-commands.md "export"): the latest snapshot in the
// shape the investor's dashboard reads. Technicals the engine has not computed are null, never
// estimated.

const fs = require('fs');
const path = require('path');
const snapshotLib = require('./snapshot');
const gtt = require('./gtt');
const marksLib = require('./marks');

const TECH = ['dma50', 'dma200', 'rsi', 'sup20', 'hi52'];

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
        key: `${broker}:${h.symbol}`, broker, sym: h.symbol, name: h.name || null, type: h.type,
        kind: h.type === 'mf' ? 'fund' : h.type === 'etf' ? 'etf' : h.type === 'equity' ? 'stock' : h.type,
        bucket: snapshotLib.bucketOf(h, profile), core: (profile.classes && profile.classes[h.symbol]) ? profile.classes[h.symbol] === 'core' : h.type !== 'equity',
        qty: h.qty, avg: h.avg ?? null, ltp: h.ltp ?? null, prevClose: prevPrice.get(`${broker}:${h.symbol}`) ?? null, fx,
        gttQty: g ? (g.issues.some((i) => i.code === 'no_gtt') ? 0 : g.qty - ((g.issues.find((i) => i.code === 'qty_short') || {}).gap || 0)) : null,
        gttStop: g ? g.stop : null, gttTarget: g ? g.target : null,
        settling: h.day_qty || 0,
        ...Object.fromEntries(TECH.map((k) => [k, typeof tech[k] === 'number' ? tech[k] : null])),
        asof: h.price_as_of || b.as_of || snap.taken_at,
        lock: marks && marks.symbols[h.symbol] ? marks.symbols[h.symbol].stage : null,
      });
    }
  }
  const cash = Object.entries(c.brokers).map(([broker, x]) => ({ broker, cash: x.cash, asof: snap.brokers[broker].as_of || snap.taken_at, status: snap.brokers[broker].status }));
  return { positions: out, cash, totals: c.totals };
}

function write(folder, out, snap, prev, profile) {
  const date = (snap.taken_at || '').slice(0, 10);
  const r = rows(snap, prev, profile, marksLib.load(folder));
  fs.mkdirSync(out, { recursive: true });
  const files = [[`positions-${date}.json`, r.positions], [`cash-${date}.json`, { cash: r.cash, totals: r.totals }]].map(([name, data]) => {
    const p = path.join(out, name);
    const text = JSON.stringify(data, null, 2);
    fs.writeFileSync(p, text);
    if (fs.readFileSync(p, 'utf8') !== text) throw new Error(`export write to ${p} did not stick`);
    return p;
  });
  return { files, positions: r.positions.length };
}

module.exports = { rows, write, TECH };
