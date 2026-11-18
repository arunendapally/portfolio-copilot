#!/usr/bin/env node
'use strict';
// Profit-lock backtest (spec 002 T067). Replays your own buys against daily closes under each
// candidate value set and prints how many lots would have been stopped, booked or kept, and the
// result next to what you actually did. Reads two CSVs you pass; writes nothing.
//
//   node core/bin/backtest-profit-lock.js --tradebook tradebook.csv --closes closes.csv
//        [--arm 10,15,20] [--book 30,40,60] [--trail 8,10,15] [--fraction 33,50]
//
// tradebook.csv: the broker's tradebook export (columns symbol, trade_date, trade_type, quantity,
//   price; Kite's export has them). closes.csv: symbol, date, close (one row per day).
// Choose values, try them on today's book with `pc profit_lock_dryrun`, then save them with
// profile_update. Nothing here is a recommendation; it shows what the rule would have done.

const fs = require('fs');
const { parseDelimited, num } = require('../lib/brokers/normalize');

function args(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i += 2) out[argv[i].replace(/^--/, '')] = argv[i + 1];
  return out;
}

function rows(file) {
  const { headers, rows: data } = parseDelimited(fs.readFileSync(file, 'utf8'));
  const h = headers.map((x) => x.toLowerCase().trim().replace(/\s+/g, '_'));
  return data.map((r) => Object.fromEntries(h.map((k, i) => [k, String(r[i] ?? '').replace(/^"|"$/g, '').trim()])));
}

const list = (s, d) => (s ? String(s).split(',').map(Number).filter((x) => !Number.isNaN(x)) : d);

// One lot under one value set. closes: [{date, close}] after the buy date, ascending.
function simulate(lot, closes, v) {
  let stage = 'idle';
  let stop = null;
  let high = lot.price;
  let qty = lot.qty;
  let realised = 0;
  let outcome = 'kept';
  for (const c of closes) {
    if (lot.sold && c.date > lot.sold.date) break;
    high = Math.max(high, c.close);
    const gain = (100 * (c.close - lot.price)) / lot.price;
    if (stop !== null && c.close <= stop) {
      realised += qty * (stop - lot.price);
      return { outcome: outcome === 'booked' ? 'booked, then stopped' : 'stopped', pnl: realised };
    }
    if (stage === 'idle' && gain >= v.arm) { stage = 'armed'; stop = lot.price; }
    if (stage === 'armed' && gain >= v.book) {
      const sell = Math.floor((qty * v.fraction) / 100);
      realised += sell * (c.close - lot.price);
      qty -= sell;
      stage = 'trailing';
      outcome = 'booked';
    }
    if (stage === 'trailing') stop = Math.max(stop, high * (1 - v.trail / 100));
  }
  const last = lot.sold ? lot.sold.price : (closes.length ? closes[closes.length - 1].close : lot.price);
  realised += qty * (last - lot.price);
  return { outcome, pnl: realised };
}

function main() {
  const a = args(process.argv);
  if (!a.tradebook || !a.closes) {
    console.error('Usage: node core/bin/backtest-profit-lock.js --tradebook tradebook.csv --closes closes.csv [--arm 10,15,20] [--book 30,40,60] [--trail 8,10,15] [--fraction 33,50]');
    process.exit(1);
  }
  const trades = rows(a.tradebook).map((t) => ({ symbol: (t.symbol || t.tradingsymbol || '').toUpperCase(), date: (t.trade_date || t.date || '').slice(0, 10), side: (t.trade_type || t.side || '').toLowerCase(), qty: num(t.quantity), price: num(t.price) }))
    .filter((t) => t.symbol && t.date && t.qty && t.price && ['buy', 'sell'].includes(t.side)).sort((x, y) => x.date.localeCompare(y.date));
  const closes = {};
  for (const r of rows(a.closes)) {
    const s = (r.symbol || '').toUpperCase();
    const c = num(r.close);
    if (s && r.date && c !== null) (closes[s] = closes[s] || []).push({ date: r.date.slice(0, 10), close: c });
  }
  for (const s of Object.keys(closes)) closes[s].sort((x, y) => x.date.localeCompare(y.date));
  // Each buy is a lot; the next sell of the symbol is what you actually did with it.
  const lots = trades.filter((t) => t.side === 'buy' && closes[t.symbol]).map((b) => ({ ...b, sold: trades.find((t) => t.side === 'sell' && t.symbol === b.symbol && t.date >= b.date) || null }));
  if (!lots.length) { console.error('No buys with closes for their symbol.'); process.exit(1); }
  const actual = lots.reduce((s, l) => s + l.qty * ((l.sold ? l.sold.price : closes[l.symbol][closes[l.symbol].length - 1].close) - l.price), 0);
  const out = [];
  for (const arm of list(a.arm, [10, 15, 20])) for (const book of list(a.book, [30, 40, 60])) for (const trail of list(a.trail, [8, 10, 15])) for (const fraction of list(a.fraction, [33, 50])) {
    if (!(arm < book)) continue;
    const res = lots.map((l) => simulate(l, closes[l.symbol].filter((c) => c.date > l.date), { arm, book, trail, fraction }));
    const n = (re) => res.filter((r) => re.test(r.outcome)).length;
    const pnl = res.reduce((s, r) => s + r.pnl, 0);
    out.push([arm, book, trail, fraction, lots.length, n(/stopped/), n(/^booked$/), n(/^kept$/), Math.round(pnl), Math.round(pnl - actual)]);
  }
  out.sort((x, y) => y[8] - x[8]);
  console.log(`Lots: ${lots.length} buys from ${lots[0].date} to ${lots[lots.length - 1].date}. What you actually did: ${Math.round(actual)} INR.`);
  console.log(['arm %', 'book %', 'trail %', 'book share %', 'lots', 'stopped', 'booked', 'kept', 'rule P&L INR', 'vs actual INR'].join('\t'));
  for (const r of out) console.log(r.join('\t'));
  console.log('Past results do not predict future ones. Try a value set on today\'s book with profit_lock_dryrun before saving it.');
}

if (require.main === module) main();
module.exports = { simulate };
