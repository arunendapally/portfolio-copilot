'use strict';
// Marks (spec 002 data-model section 3): per holding in profit-lock scope, the highest close since
// tracking began and the lock stage. high_close only rises; stages only move forward, except a
// reset to idle when the holding is fully sold. A holding sold while trailing goes on the
// re-entry list with the investor's cooling-off.

const path = require('path');
const { stateDir, readJson, writeJson } = require('./state');

const STAGES = ['idle', 'armed', 'booked', 'trailing'];
const file = (folder) => path.join(stateDir(folder), 'marks.json');

function load(folder) {
  return readJson(file(folder), null) || { schema_version: 1, symbols: {}, reentry: [] };
}

function save(folder, marks) {
  writeJson(file(folder), marks);
  return marks;
}

// Funds never; stocks by class: scope "play" takes play stocks, "all_stocks" every stock.
function inScope(h, profile) {
  if (h.type !== 'equity') return false;
  const lock = profile.gtt_policy.profit_lock;
  if (lock.scope === 'all_stocks') return true;
  const cls = (profile.classes && profile.classes[h.symbol]) || 'play';
  return cls === 'play';
}

const forward = (from, to) => STAGES.indexOf(to) > STAGES.indexOf(from);

// Update from a snapshot. `stops` maps symbol -> current stop (from the GTT audit).
function update(marks, snap, profile, stops = {}, now = new Date()) {
  const lock = profile.gtt_policy.profit_lock;
  const day = now.toISOString().slice(0, 10);
  const kite = (snap.brokers && snap.brokers.kite) || {};
  const held = new Map((kite.holdings || []).filter((h) => inScope(h, profile)).map((h) => [h.symbol, h]));
  for (const [sym, h] of held) {
    const m = marks.symbols[sym] || { since: day, high_close: h.ltp, high_at: day, stage: 'idle', stage_at: null, booked_qty: 0, last_stop: null, last_qty: h.qty, source: 'snapshot' };
    if (h.ltp > m.high_close) Object.assign(m, { high_close: h.ltp, high_at: day });
    const stop = stops[sym] === undefined ? null : stops[sym];
    if (stop !== null) m.last_stop = Math.max(m.last_stop || 0, stop);
    const gain = h.avg ? (100 * (h.ltp - h.avg)) / h.avg : null;
    let to = m.stage;
    if (m.stage === 'idle' && lock.enabled && gain !== null && gain >= lock.arm_gain_pct && stop !== null && stop >= h.avg) to = 'armed';
    if (m.stage === 'armed' && m.last_qty && h.qty < m.last_qty) { to = 'booked'; m.booked_qty += m.last_qty - h.qty; }
    else if (m.stage === 'booked' && m.stage_at && m.stage_at < day) to = 'trailing';
    if (forward(m.stage, to)) Object.assign(m, { stage: to, stage_at: day });
    m.last_qty = h.qty;
    marks.symbols[sym] = m;
  }
  // Fully sold: back to idle; sold while trailing (or booked): listed for re-entry review.
  for (const [sym, m] of Object.entries(marks.symbols)) {
    if (held.has(sym)) continue;
    if (['trailing', 'booked'].includes(m.stage) && !marks.reentry.some((r) => r.symbol === sym && r.exited_at === day)) {
      marks.reentry.push({ symbol: sym, exited_at: day, by: 'trailing_stop', cooloff_days: lock.reentry_cooloff_days, needs: 'fresh thesis' });
    }
    delete marks.symbols[sym];
  }
  return marks;
}

// A confirmed corporate action re-bases the high and the last stop by the price factor.
function rebase(marks, symbol, factor) {
  const m = marks.symbols[symbol];
  if (!m || typeof factor !== 'number') return marks;
  m.high_close = Math.round(m.high_close * factor * 100) / 100;
  if (m.last_stop !== null) m.last_stop = Math.round(m.last_stop * factor * 100) / 100;
  return marks;
}

module.exports = { STAGES, load, save, update, rebase, inScope };
