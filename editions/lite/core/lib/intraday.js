'use strict';
// Intraday levels, sizing and replay (issues #36, #37). Candles are the caller's own reads from the
// broker (5-minute: t as an ISO time, o h l c v). Nothing here predicts: it derives levels from the
// candles given, sizes the quantity so a stop costs the per-trade risk, nets out charges, and later
// replays each logged call against the candles that followed.

const path = require('path');
const { stateDir, readJson, writeJson } = require('./state');
const { roundTrip } = require('./charges');
const { tick } = require('./gtt');

const OPENING_RANGE_CANDLES = 3; // first 15 minutes of 5-minute candles
const SWING_CANDLES = 6;
const r2 = (n) => Math.round(n * 100) / 100;
const file = (folder) => path.join(stateDir(folder), 'intraday-calls.json');

function levels(candles) {
  const c = candles.map((x) => x.c);
  const first = candles.slice(0, OPENING_RANGE_CANDLES);
  const vol = candles.reduce((a, x) => a + (x.v || 0), 0);
  const vwap = vol > 0 ? r2(candles.reduce((a, x) => a + ((x.h + x.l + x.c) / 3) * (x.v || 0), 0) / vol) : null;
  const k = 2 / 21;
  const ema20 = c.length >= 20 ? r2(c.slice(1).reduce((e, x) => x * k + e * (1 - k), c.slice(0, 20).reduce((a, x) => a + x, 0) / 20)) : null;
  const tail = candles.slice(-SWING_CANDLES);
  return {
    or_high: first.length === OPENING_RANGE_CANDLES ? Math.max(...first.map((x) => x.h)) : null,
    or_low: first.length === OPENING_RANGE_CANDLES ? Math.min(...first.map((x) => x.l)) : null,
    vwap, ema20, swing_low: Math.min(...tail.map((x) => x.l)), swing_high: Math.max(...tail.map((x) => x.h)),
    last: c[c.length - 1], candles: candles.length,
  };
}

// side long|short; risk_inr = what a stopped trade may cost before charges; target_r = reward in multiples of risk.
function plan({ candles, side = 'long', risk_inr, product = 'MIS', entry, target_r = 2, buffer_pct = 0.1 }, profile) {
  if (!Array.isArray(candles) || candles.length < OPENING_RANGE_CANDLES) return { ok: false, error: `need at least ${OPENING_RANGE_CANDLES} candles` };
  if (!(risk_inr > 0)) return { ok: false, error: 'risk_inr required (the most one stopped trade may cost)' };
  const L = levels(candles);
  const px = typeof entry === 'number' ? entry : L.last;
  const long = side !== 'short';
  const stop = tick(long ? L.swing_low * (1 - buffer_pct / 100) : L.swing_high * (1 + buffer_pct / 100));
  const perShare = long ? px - stop : stop - px;
  if (!(perShare > 0)) return { ok: false, error: 'entry is not on the right side of the structure stop', levels: L };
  const qty = Math.floor(risk_inr / perShare);
  if (qty < 1) return { ok: false, error: `risk of ${risk_inr} is below one share's stop distance (${r2(perShare)})`, levels: L };
  const target = tick(long ? px + target_r * perShare : px - target_r * perShare);
  const ch = (exit) => roundTrip({ qty, buy: long ? px : exit, sell: long ? exit : px, product }, profile);
  const atTarget = ch(target);
  const atStop = ch(stop);
  const gross = qty * Math.abs(target - px);
  const loss = qty * perShare;
  return {
    ok: true, side: long ? 'long' : 'short', product, entry: px, stop, target, qty, levels: L,
    risk_gross: r2(loss), reward_gross: r2(gross),
    charges_at_target: atTarget.total, charges_at_stop: atStop.total, charges_per_share: atTarget.per_share,
    net_reward: r2(gross - atTarget.total), net_risk: r2(loss + atStop.total),
    net_rr: r2((gross - atTarget.total) / (loss + atStop.total)),
    default_rates: atTarget.default_rates, rates_source: atTarget.rates_source,
  };
}

function load(folder) {
  return readJson(file(folder), null) || { schema_version: 1, calls: [] };
}

function logCall(folder, symbol, p, now, day) {
  const store = load(folder);
  const n = store.calls.filter((c) => c.date === day).length + 1;
  const call = { id: `IC-${day}-${n}`, date: day, time: now.toISOString(), symbol, side: p.side, product: p.product, entry: p.entry, stop: p.stop, target: p.target, qty: p.qty };
  store.calls.push(call);
  writeJson(file(folder), store);
  return call;
}

// prices: { SYMBOL: ltp }. A call is stopped, at target or still open on that price.
function watch(folder, day, prices) {
  return load(folder).calls.filter((c) => c.date === day).map((c) => {
    const p = prices[c.symbol];
    if (typeof p !== 'number') return { ...c, state: 'no price' };
    const long = c.side === 'long';
    const state = (long ? p <= c.stop : p >= c.stop) ? 'stop hit' : (long ? p >= c.target : p <= c.target) ? 'target hit' : 'open';
    return { ...c, ltp: p, state };
  });
}

// Replay one call against the candles after it. Both levels inside one candle counts as stopped.
function replay(call, candles, profile) {
  const after = candles.filter((x) => x.t > call.time);
  if (!after.length) return { ...call, outcome: 'no candles after the call' };
  const long = call.side === 'long';
  let exit = null;
  let outcome = null;
  for (const x of after) {
    const hitStop = long ? x.l <= call.stop : x.h >= call.stop;
    const hitTarget = long ? x.h >= call.target : x.l <= call.target;
    if (hitStop) { exit = call.stop; outcome = 'stopped'; break; }
    if (hitTarget) { exit = call.target; outcome = 'target'; break; }
  }
  if (!outcome) { exit = after[after.length - 1].c; outcome = call.product === 'MIS' ? 'squared off at the last close' : 'still open at the last close'; }
  const gross = (long ? exit - call.entry : call.entry - exit) * call.qty;
  const ch = roundTrip({ qty: call.qty, buy: long ? call.entry : exit, sell: long ? exit : call.entry, product: call.product }, profile);
  return { ...call, outcome, exit, gross: r2(gross), charges: ch.total, net: r2(gross - ch.total), default_rates: ch.default_rates };
}

function retro(folder, day, candlesBySymbol, profile) {
  const results = load(folder).calls.filter((c) => c.date === day).map((c) => replay(c, candlesBySymbol[c.symbol] || [], profile));
  const done = results.filter((r) => typeof r.net === 'number');
  return {
    results, calls: results.length,
    net: r2(done.reduce((a, r) => a + r.net, 0)), charges: r2(done.reduce((a, r) => a + r.charges, 0)),
    losses: r2(done.filter((r) => r.net < 0).reduce((a, r) => a - r.net, 0)),
    won: done.filter((r) => r.net > 0).length, lost: done.filter((r) => r.net < 0).length,
    default_rates: done.some((r) => r.default_rates),
  };
}

module.exports = { levels, plan, logCall, watch, replay, retro, load, OPENING_RANGE_CANDLES, SWING_CANDLES };
