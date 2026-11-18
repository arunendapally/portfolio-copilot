'use strict';
// Technicals from the engine's own daily closes (spec 002 FR-052, T091). Each refresh adds the
// day's close per held symbol to closes.json; an average or RSI appears only once there are
// enough closes for it, and carries the date of the last close. Nothing is estimated.

const path = require('path');
const { stateDir, readJson, writeJson } = require('./state');

const KEEP = 260;
const file = (folder) => path.join(stateDir(folder), 'closes.json');

function load(folder) {
  return readJson(file(folder), null) || { schema_version: 1, symbols: {} };
}

// One close per symbol per day; the latest reading of the day wins.
function addCloses(store, snap, day) {
  for (const b of Object.values(snap.brokers || {})) {
    for (const h of b.holdings || []) {
      if (typeof h.ltp !== 'number' || h.type === 'mf' || h.frozen) continue;
      const s = store.symbols[h.symbol] || (store.symbols[h.symbol] = []);
      const last = s[s.length - 1];
      if (last && last.date === day) last.close = h.ltp;
      else if (!last || last.date < day) s.push({ date: day, close: h.ltp });
      if (s.length > KEEP) s.splice(0, s.length - KEEP);
    }
  }
  return store;
}

const mean = (xs) => xs.reduce((a, x) => a + x, 0) / xs.length;
const r2 = (n) => Math.round(n * 100) / 100;

function rsi(closes, n = 14) {
  if (closes.length < n + 1) return null;
  let gain = 0;
  let loss = 0;
  for (let i = closes.length - n; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) gain += d; else loss -= d;
  }
  if (loss === 0) return 100;
  return r2(100 - 100 / (1 + gain / loss));
}

function compute(series) {
  const c = series.map((x) => x.close);
  const tail = (n) => c.slice(-n);
  return {
    dma50: c.length >= 50 ? r2(mean(tail(50))) : null,
    dma200: c.length >= 200 ? r2(mean(tail(200))) : null,
    rsi: rsi(c, 14),
    sup20: c.length >= 20 ? Math.min(...tail(20)) : null,
    hi52: c.length >= 250 ? Math.max(...tail(250)) : null,
    closes: c.length,
    as_of: series.length ? series[series.length - 1].date : null,
  };
}

function forSnapshot(store) {
  return Object.fromEntries(Object.entries(store.symbols).map(([s, series]) => [s, compute(series)]));
}

function update(folder, snap, day) {
  const store = addCloses(load(folder), snap, day);
  writeJson(file(folder), store);
  return forSnapshot(store);
}

// History pulled by a collector (closes for many days at once) merges in, oldest first.
function merge(folder, symbol, rows) {
  const store = load(folder);
  const by = new Map((store.symbols[symbol] || []).map((x) => [x.date, x.close]));
  for (const r of rows) by.set(r.date, r.close);
  store.symbols[symbol] = [...by.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-KEEP).map(([date, close]) => ({ date, close }));
  writeJson(file(folder), store);
  return store.symbols[symbol].length;
}

module.exports = { load, update, compute, rsi, merge, addCloses };
