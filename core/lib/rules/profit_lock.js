'use strict';
// Profit lock (spec 002 US4): past the arm threshold the stop goes to cost; past the booking
// threshold a slice is sold; after that the stop trails the highest close. Stops only move up.
// Off until the investor sets every value (FR-026): no defaults here.

const tasks = require('../tasks');
const gtt = require('../gtt');
const marksLib = require('../marks');

const round = (n, d = 1) => Math.round(n * 10 ** d) / 10 ** d;

// What the rule wants for each holding in scope, at thresholds `t` (the profile's, or a dry run's).
function states(snap, profile, marks, t, stops = {}, { dry = false } = {}) {
  const kite = (snap && snap.brokers && snap.brokers.kite) || {};
  const out = [];
  for (const h of (kite.holdings || []).filter((x) => marksLib.inScope(x, profile) && x.avg && x.ltp)) {
    const m = (marks && marks.symbols[h.symbol]) || { stage: 'idle', high_close: h.ltp };
    const stop = stops[h.symbol] === undefined ? null : stops[h.symbol];
    const gain = (100 * (h.ltp - h.avg)) / h.avg;
    const cost = gtt.tick(h.avg);
    const trail = t.trail_pct ? gtt.tick(Math.max(m.high_close, h.ltp) * (1 - t.trail_pct / 100)) : null;
    // A dry run has no history: a holding past the booking threshold is shown as a booking.
    const armed = m.stage === 'armed' || (dry && m.stage === 'idle');
    let want = 'idle';
    let proposed = null;
    if (['booked', 'trailing'].includes(m.stage) && trail !== null) { want = 'trailing'; proposed = trail; }
    else if (armed && gain >= t.book_gain_pct) { want = 'book'; proposed = Math.max(stop || 0, cost); }
    else if (gain >= t.arm_gain_pct) { want = 'armed'; proposed = cost; }
    // Never propose a lower stop than the one in place (FR-028).
    if (proposed !== null && stop !== null && proposed < stop) proposed = stop;
    out.push({ symbol: h.symbol, qty: h.qty, avg: h.avg, ltp: h.ltp, gain_pct: round(gain), stop, stop_vs_cost_pct: stop === null ? null : round((100 * (stop - h.avg)) / h.avg), stage: m.stage, want, proposed_stop: proposed, high_close: m.high_close });
  }
  return out;
}

// Stop targets the GTT plan must honour for locked or arming holdings.
function targets(snap, profile, marks, stops) {
  const lock = profile.gtt_policy.profit_lock;
  if (!lock.enabled) return {};
  const out = {};
  for (const s of states(snap, profile, marks, lock, stops)) if (s.proposed_stop !== null && s.want !== 'idle') out[s.symbol] = s.proposed_stop;
  return out;
}

function stopsOf(snap, profile) {
  const a = gtt.audit(snap, null, profile);
  return Object.fromEntries(a.rows.map((r) => [r.symbol, r.stop]));
}

function evaluate({ snap, profile, marks, edition }) {
  const lock = profile.gtt_policy.profit_lock;
  if (!lock.enabled || !snap) return [];
  const stops = stopsOf(snap, profile);
  const at = snap.taken_at;
  const out = [];
  for (const s of states(snap, profile, marks, lock, stops)) {
    const base = [
      { name: 'gain_over_cost_pct', value: s.gain_pct, base: 'average cost', as_of: at },
      { name: 'stop_vs_cost_pct', value: s.stop_vs_cost_pct === null ? 'no stop' : s.stop_vs_cost_pct, base: 'average cost', as_of: at },
    ];
    if (s.want === 'armed' && (s.stop === null || s.stop < s.avg)) {
      out.push(tasks.make({
        kind: 'profit_lock_arm', symbol: s.symbol, rule_ref: 'gtt_policy.profit_lock.arm_gain_pct', bucket: 'arm',
        title: `Raise ${s.symbol} stop to cost`, measurements: base,
        options: [{ id: 'do', label: `Raise the stop to cost (${s.proposed_stop})`, draft_kind: 'gtt_plan' }, { id: 'nothing', label: 'Leave the stop where it is' }],
        executor: 'plugin', needs_fresh: ['kite'], expect: { kind: 'gtt_stop', symbol: s.symbol, min_stop: s.proposed_stop },
      }, { edition }));
    } else if (s.want === 'book') {
      const qty = Math.max(1, Math.floor((s.qty * lock.book_fraction_pct) / 100));
      out.push(tasks.make({
        kind: 'profit_lock_book', symbol: s.symbol, rule_ref: 'gtt_policy.profit_lock.book_gain_pct', bucket: 'book',
        title: `Book ${lock.book_fraction_pct}% of ${s.symbol}`,
        measurements: [...base, { name: 'sell_qty', value: qty, base: `${lock.book_fraction_pct}% of ${s.qty} held` }, { name: 'proceeds_to', value: lock.proceeds_to || 'not set', base: 'your profit-lock rule' }],
        options: [{ id: 'do', label: `Sell ${qty} ${s.symbol} (proceeds to ${lock.proceeds_to || 'cash'})`, sell: { symbol: s.symbol, qty, price: s.ltp } }, { id: 'nothing', label: 'Hold the whole position' }],
        executor: 'investor', needs_fresh: ['kite'], expect: { kind: 'holding_qty', symbol: s.symbol, max_qty: s.qty - qty },
      }, { edition }));
    } else if (s.want === 'trailing' && s.proposed_stop !== null && (s.stop === null || s.proposed_stop > s.stop)) {
      out.push(tasks.make({
        kind: 'profit_lock_trail', symbol: s.symbol, rule_ref: 'gtt_policy.profit_lock.trail_pct', bucket: s.proposed_stop,
        title: `Trail ${s.symbol} stop up to ${s.proposed_stop}`,
        measurements: [...base, { name: 'high_close', value: s.high_close, base: 'highest close since tracking began' }],
        options: [{ id: 'do', label: `Raise the stop to ${s.proposed_stop}`, draft_kind: 'gtt_plan' }, { id: 'nothing', label: 'Leave the stop' }],
        executor: 'plugin', needs_fresh: ['kite'], expect: { kind: 'gtt_stop', symbol: s.symbol, min_stop: s.proposed_stop },
      }, { edition }));
    }
  }
  return out;
}

function notSet(profile) {
  return profile.gtt_policy.profit_lock.enabled ? [] : ['profit lock'];
}

module.exports = { evaluate, notSet, states, targets, stopsOf };
