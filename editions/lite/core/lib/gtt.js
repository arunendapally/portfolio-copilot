'use strict';
// GTT audit under the investor's policy, and change plans that place before they delete.

const { verdictOf } = require('./profile');
const { round } = require('./format');

const ACTIVE = 'active';
const NEAR_PCT = 2;

function tick(p) {
  return round(Math.round(p / 0.05) * 0.05, 2);
}

function sellQty(g) {
  return Math.max(0, ...g.legs.filter((l) => l.side === 'SELL').map((l) => l.qty || 0));
}

// Split a GTT's triggers into stop (below price) and target (above price) using LIVE price.
function legsOf(g, ltp) {
  if (g.type === 'two-leg') return { stop: Math.min(...g.triggers), target: Math.max(...g.triggers) };
  const t = g.triggers[0];
  return t < ltp ? { stop: t, target: null } : { stop: null, target: t };
}

function priceFactor(ca) {
  if (typeof ca.price_factor === 'number') return ca.price_factor;
  const m = String(ca.ratio || '').match(/^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (ca.kind === 'bonus') return b / (a + b); // a new shares for every b held
  if (ca.kind === 'split') return b / a; // face value a -> b
  return null;
}

function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// A recorded "keep the stop" decision holds until review_by (inclusive); no review_by means until revoked.
function stopKept(v, today) {
  const r = v && v.stop_review;
  return !!(r && r.decision === 'keep' && (!r.review_by || !today || r.review_by >= today));
}

function audit(snap, prev, profile, { corporateActions = [], today = null } = {}) {
  const pol = profile.gtt_policy;
  const kite = (snap.brokers && snap.brokers.kite) || { holdings: [], gtts: [] };
  const holdings = (kite.holdings || []).filter((h) => h.type === 'equity' || h.type === 'etf');
  const gtts = kite.gtts || [];
  const active = gtts.filter((g) => g.status === ACTIVE);
  const rows = [];
  const distances = [];

  for (const h of holdings) {
    const mine = active.filter((g) => g.symbol === h.symbol && g.legs.some((l) => l.side === 'SELL'));
    const v = verdictOf(profile, h.symbol);
    const cls = h.type === 'etf' ? 'etf' : ['exit', 'reduce'].includes(v.stance) ? 'exit' : v.stance === 'trade' ? 'trade' : 'hold';
    const issues = [];
    let stop = null;
    let target = null;
    // Several GTTs on a hold name: one that already meets policy at full quantity is the keeper.
    const keep = cls === 'hold' && mine.length > 1 ? mine.find((g) => {
      const l = legsOf(g, h.ltp);
      return l.stop !== null && h.ltp && (100 * (h.ltp - l.stop)) / h.ltp >= pol.min_stop_distance_pct && sellQty(g) >= h.qty;
    }) : null;
    for (const g of keep ? [keep] : mine) {
      const l = legsOf(g, h.ltp);
      if (l.stop !== null) stop = stop === null ? l.stop : Math.max(stop, l.stop);
      if (l.target !== null) target = target === null ? l.target : Math.min(target, l.target);
    }
    const covered = mine.reduce((a, g) => a + sellQty(g), 0);
    const single = mine.length === 1 ? sellQty(mine[0]) : null;
    if (!mine.length) {
      issues.push({ code: 'no_gtt', severity: cls === 'etf' ? 'info' : 'warn', text: 'no active GTT' });
    } else if (mine.length > 1 && covered > h.qty) {
      issues.push({ code: 'double_coverage', severity: 'warn', text: `${mine.length} GTTs cover ${covered} vs ${h.qty} held` });
    } else if (single !== null && single < h.qty) {
      issues.push({ code: 'qty_short', severity: 'warn', text: `GTT ${single} vs ${h.qty} held (${h.qty - single} unprotected, value ${round((h.qty - single) * h.ltp)})`, gap: h.qty - single, gap_value: round((h.qty - single) * h.ltp) });
    } else if (single !== null && single > h.qty) {
      issues.push({ code: 'qty_excess', severity: 'info', text: `GTT ${single} vs ${h.qty} held (not updated after a sale?)` });
    }

    const dist = stop !== null && h.ltp ? (100 * (h.ltp - stop)) / h.ltp : null;
    if (dist !== null) distances.push(dist);
    if (cls === 'etf' && stop !== null && !pol.etf_stop) issues.push({ code: 'etf_stop', severity: 'warn', text: 'ETF has a stop-loss; policy: target only, no stop' });
    if (cls === 'exit') {
      if (stop !== null && !pol.exit_verdict_stop) issues.push({ code: 'exit_stop', severity: 'warn', text: `${v.stance.toUpperCase()} verdict has a stop; policy: single exit at the written level` });
      if (v.exit_level && !(target !== null && Math.abs(target - v.exit_level) / v.exit_level < 0.01)) issues.push({ code: 'exit_missing', severity: 'warn', text: `no exit GTT at the written level ${v.exit_level}` });
    }
    if (cls === 'hold') {
      if (stop === null) issues.push({ code: 'no_crash_floor', severity: 'info', text: `no crash-floor stop (policy: about ${pol.crash_floor_pct}% below)` });
      else if (dist < pol.min_stop_distance_pct) {
        if (stopKept(v, today)) issues.push({ code: 'stop_kept', severity: 'info', text: `stop ${round(dist, 1)}% below price, kept by decision on ${v.stop_review.at || 'an earlier date'}${v.stop_review.review_by ? ` (review by ${v.stop_review.review_by})` : ''}` });
        else issues.push({ code: 'stop_too_tight', severity: 'warn', text: `stop ${round(dist, 1)}% below price; policy minimum ${pol.min_stop_distance_pct}%` });
      }
    }
    if (stop !== null && dist !== null && dist >= 0 && dist <= NEAR_PCT) issues.push({ code: 'near_stop', severity: 'warn', text: `stop ${stop} is ${round(dist, 1)}% below live price` });
    if (target !== null && h.ltp && ((target - h.ltp) / h.ltp) * 100 <= NEAR_PCT && target >= h.ltp) issues.push({ code: 'near_target', severity: 'info', text: `target ${target} within ${NEAR_PCT}% of live price` });

    const ca = corporateActions.find((c) => c.symbol && c.symbol.toUpperCase() === h.symbol);
    if (ca) {
      const f = priceFactor(ca);
      if (f === null) issues.push({ code: 'corp_action', severity: 'warn', text: `${ca.kind} ${ca.ratio || ''} on ${ca.ex_date || 'unknown date'}: cannot compute adjusted price; review GTTs manually` });
      else {
        const adj = h.ltp * f;
        const firing = mine.filter((g) => g.triggers.some((t) => t > adj && t < h.ltp));
        issues.push({
          code: 'corp_action', severity: firing.length ? 'critical' : 'info',
          text: `${ca.kind} ${ca.ratio || ''} ex ${ca.ex_date || '?'}${ca.confirmed ? '' : ' (date unconfirmed)'}: adjusted price about ${round(adj)}${firing.length ? `; GTT ${firing.map((g) => g.id).join(', ')} would fire at the open` : ''}`,
        });
      }
    }
    rows.push({ symbol: h.symbol, class: cls, stance: v.stance, implicit_verdict: !!v.implicit, qty: h.qty, ltp: h.ltp, value: round(h.qty * h.ltp), stop, target, stop_distance_pct: dist === null ? null : round(dist, 1), gtt_ids: mine.map((g) => g.id), keep_id: keep ? keep.id : null, issues });
  }

  // Outliers: stops much tighter than the book's own convention.
  const med = median(distances.filter((d) => d > 0));
  if (med !== null) {
    for (const r of rows) {
      if (r.stop_distance_pct !== null && r.stop_distance_pct > 0 && r.stop_distance_pct < med / 2 && !r.issues.some((i) => i.code === 'stop_too_tight')) {
        r.issues.push({ code: 'stop_outlier', severity: 'info', text: `stop ${r.stop_distance_pct}% below vs book median ${round(med, 1)}%` });
      }
    }
  }

  const held = new Set(holdings.map((h) => h.symbol));
  const orphans = active.filter((g) => !held.has(g.symbol) && g.legs.some((l) => l.side === 'SELL')).map((g) => ({ id: g.id, symbol: g.symbol, triggers: g.triggers }));
  const inactive = gtts.filter((g) => g.status !== ACTIVE && held.has(g.symbol)).map((g) => ({ id: g.id, symbol: g.symbol, status: g.status, reason: g.reason }));
  const vanished = [];
  if (prev && prev.brokers && prev.brokers.kite) {
    const now = new Set(gtts.map((g) => g.id));
    for (const g of prev.brokers.kite.gtts || []) {
      if (g.status === ACTIVE && !now.has(g.id) && held.has(g.symbol)) vanished.push({ id: g.id, symbol: g.symbol });
    }
  }

  const isKept = (r) => r.issues.some((i) => i.code === 'stop_kept');
  const crash = (pol.crash_test_pcts || []).map((p) => {
    const fires = rows.filter((r) => r.stop !== null && r.stop >= r.ltp * (1 - p / 100));
    const holds = fires.filter((r) => r.class === 'hold');
    return { move_pct: -p, fires: fires.map((r) => ({ symbol: r.symbol, class: r.class, stop: r.stop })), hold_names_firing: holds.filter((r) => !isKept(r)).map((r) => r.symbol), kept_names_firing: holds.filter(isKept).map((r) => r.symbol) };
  });
  const worst = crash[crash.length - 1];
  const summary = {
    holdings: rows.length, active_gtts: active.length,
    unprotected_value: round(rows.reduce((a, r) => a + r.issues.filter((i) => i.code === 'qty_short').reduce((b, i) => b + i.gap_value, 0) + (r.issues.some((i) => i.code === 'no_gtt') && r.class !== 'etf' ? r.value : 0), 0)),
    crash_test_pass: worst ? worst.hold_names_firing.length === 0 : true,
  };
  return { summary, rows, orphans, inactive, vanished, crash, median_stop_distance_pct: med === null ? null : round(med, 1) };
}

function gttArgs(symbol, exchange, ltp, { stop, target, qty }) {
  const base = { exchange, tradingsymbol: symbol, last_price: ltp, transaction_type: 'SELL', product: 'CNC' };
  if (stop !== null && target !== null) {
    return { ...base, trigger_type: 'two-leg', lower_trigger_value: stop, lower_quantity: qty, lower_limit_price: tick(stop * 0.99), upper_trigger_value: target, upper_quantity: qty, upper_limit_price: target };
  }
  const t = stop !== null ? stop : target;
  return { ...base, trigger_type: 'single', trigger_value: t, quantity: qty, limit_price: stop !== null ? tick(t * 0.99) : t };
}

// Turn audit findings into ordered steps: every placement first, deletions after.
function plan(auditResult, snap, profile, { symbols } = {}) {
  const pol = profile.gtt_policy;
  const holdings = new Map(((snap.brokers.kite || {}).holdings || []).map((h) => [h.symbol, h]));
  const places = [];
  const deletes = [];
  const notes = [];
  for (const r of auditResult.rows) {
    if (symbols && !symbols.map((s) => s.toUpperCase()).includes(r.symbol)) continue;
    const codes = new Set(r.issues.map((i) => i.code));
    const h = holdings.get(r.symbol);
    let want = null;
    let reason = '';
    // A compliant GTT already covers the full quantity: only remove the duplicates.
    if (r.keep_id && codes.has('double_coverage') && !['stop_too_tight', 'no_crash_floor', 'qty_short', 'no_gtt', 'etf_stop', 'exit_stop', 'exit_missing'].some((c) => codes.has(c))) {
      for (const id of r.gtt_ids.filter((x) => x !== r.keep_id)) deletes.push({ action: 'delete', symbol: r.symbol, gtt_id: id, reason: `duplicate: #${r.keep_id} already meets policy` });
      continue;
    }
    if (r.class === 'etf' && codes.has('etf_stop')) {
      if (r.target !== null) { want = { stop: null, target: r.target }; reason = 'ETF: keep target, remove stop'; }
      else { notes.push(`${r.symbol}: ETF stop to remove; no target on file, so no replacement is placed`); }
    } else if (r.class === 'exit' && (codes.has('exit_stop') || codes.has('exit_missing') || codes.has('qty_short'))) {
      const v = profile.verdicts[r.symbol] || {};
      if (v.exit_level) { want = { stop: null, target: v.exit_level }; reason = `${r.stance.toUpperCase()}: single exit at ${v.exit_level}`; }
      else notes.push(`${r.symbol}: ${r.stance.toUpperCase()} verdict has no exit_level; write one to plan this GTT`);
    } else if (r.class === 'hold' && (codes.has('stop_too_tight') || codes.has('no_crash_floor') || codes.has('qty_short') || codes.has('double_coverage') || codes.has('no_gtt'))) {
      const floor = tick(r.ltp * (1 - pol.crash_floor_pct / 100));
      const keepStop = r.stop !== null && (r.stop_distance_pct >= pol.min_stop_distance_pct || codes.has('stop_kept')) ? r.stop : floor;
      want = { stop: keepStop, target: r.target };
      reason = codes.has('stop_too_tight') ? `widen stop to crash floor ${pol.crash_floor_pct}% below` : codes.has('no_crash_floor') || codes.has('no_gtt') ? 'add crash-floor stop' : 'match GTT quantity to holding';
    } else if (codes.has('qty_short') || codes.has('double_coverage')) {
      want = { stop: r.stop, target: r.target };
      reason = 'match GTT quantity to holding';
    }
    if (codes.has('etf_stop') && !want) {
      for (const id of r.gtt_ids) deletes.push({ action: 'delete', symbol: r.symbol, gtt_id: id, reason: 'ETF: remove stop' });
      continue;
    }
    if (!want) continue;
    // Keep the exchange of the GTT being replaced; Kite holdings report NSE even for a BSE GTT.
    const old = ((snap.brokers.kite || {}).gtts || []).find((g) => r.gtt_ids.includes(g.id));
    const exchange = (old && old.exchange) || h.exchange || 'NSE';
    places.push({ action: 'place', symbol: r.symbol, exchange, reason, args: gttArgs(r.symbol, exchange, r.ltp, { ...want, qty: r.qty }) });
    for (const id of r.gtt_ids) deletes.push({ action: 'delete', symbol: r.symbol, gtt_id: id, reason: 'replaced by the new GTT above' });
  }
  for (const o of auditResult.orphans) deletes.push({ action: 'delete', symbol: o.symbol, gtt_id: o.id, reason: 'orphan: symbol no longer held' });
  const rows = [...places, ...deletes].map((r, i) => ({ step: i + 1, ...r }));
  return { rows, notes };
}

module.exports = { audit, plan, legsOf, priceFactor, gttArgs, tick };
