'use strict';
// GTT audit findings as review tasks (spec 002 T049). The audit judges; this only phrases each
// finding as one decision with its reason, options and the effect verification checks.

const gtt = require('../gtt');
const tasks = require('../tasks');

const asOf = (snap) => (snap.brokers.kite && snap.brokers.kite.as_of) || snap.taken_at;

// code -> how the task reads. kind gtt_gap: protection missing; gtt_policy: protection against policy.
const MAP = {
  no_gtt: { kind: 'gtt_gap', title: (r) => `Protect ${r.symbol}: no GTT`, rule: 'gtt_policy.crash_floor_pct', expect: (r) => ({ kind: 'gtt_qty', symbol: r.symbol, qty: r.qty }), when: (r) => r.class !== 'etf' },
  qty_short: { kind: 'gtt_gap', title: (r, i) => `Cover all ${r.qty} ${r.symbol}: GTT short by ${i.gap}`, rule: 'gtt_policy (GTT quantity equals held quantity)', expect: (r) => ({ kind: 'gtt_qty', symbol: r.symbol, qty: r.qty }) },
  double_coverage: { kind: 'gtt_gap', title: (r) => `Remove the extra GTT on ${r.symbol}`, rule: 'gtt_policy (one GTT per holding)', expect: (r) => ({ kind: 'gtt_qty', symbol: r.symbol, qty: r.qty, exact: true }) },
  stop_too_tight: { kind: 'gtt_policy', title: (r) => `Widen the ${r.symbol} stop`, rule: 'gtt_policy.min_stop_distance_pct', expect: (r, p) => ({ kind: 'gtt_stop', symbol: r.symbol, max_stop: Math.round(r.ltp * (1 - p.gtt_policy.min_stop_distance_pct / 100) * 100) / 100 }) },
  etf_stop: { kind: 'gtt_policy', title: (r) => `Remove the stop on ETF ${r.symbol}`, rule: 'gtt_policy.etf_stop', expect: (r) => ({ kind: 'gtt_stop', symbol: r.symbol, none: true }) },
  exit_stop: { kind: 'gtt_policy', title: (r) => `Replace the ${r.symbol} stop with its exit order`, rule: 'gtt_policy.exit_verdict_stop', expect: (r) => ({ kind: 'gtt_stop', symbol: r.symbol, none: true }) },
  exit_missing: { kind: 'gtt_policy', title: (r) => `Place the ${r.symbol} exit at your written level`, rule: `verdicts.<symbol>.exit_level`, expect: (r, p) => ({ kind: 'gtt_target', symbol: r.symbol, target: (p.verdicts[r.symbol] || {}).exit_level }) },
  near_stop: { kind: 'gtt_policy', title: (r) => `${r.symbol} is near its stop: review`, rule: 'gtt near-stop check', expect: () => ({ kind: 'none' }), draft: false },
  corp_action: { kind: 'gtt_policy', title: (r) => `Adjust ${r.symbol} GTTs for a corporate action`, rule: 'corporate action re-scoring', expect: () => ({ kind: 'none' }), when: (r, i) => i.severity !== 'info' },
};

function evaluate({ snap, prev, profile, corporateActions = [], today, edition = 'full' }) {
  if (!snap || !snap.brokers || !snap.brokers.kite) return [];
  const a = gtt.audit(snap, prev, profile, { corporateActions, today });
  const out = [];
  for (const r of a.rows) {
    for (const i of r.issues) {
      const m = MAP[i.code];
      if (!m || (m.when && !m.when(r, i))) continue;
      const draft = m.draft !== false;
      out.push(tasks.make({
        kind: m.kind, symbol: r.symbol, rule_ref: m.rule.replace('<symbol>', r.symbol), bucket: i.code,
        title: m.title(r, i),
        measurements: [
          { name: 'finding', value: i.text, base: 'GTT audit', as_of: asOf(snap) },
          ...(r.stop_distance_pct !== null ? [{ name: 'stop_below_price_pct', value: r.stop_distance_pct, base: 'last price', as_of: asOf(snap) }] : []),
        ],
        options: draft
          ? [{ id: 'do', label: 'Fix it (draft a GTT change)', draft_kind: 'gtt_plan' }, { id: 'nothing', label: 'Leave it' }]
          : [{ id: 'do', label: 'Review it now', draft_kind: null }, { id: 'nothing', label: 'Leave it' }],
        executor: draft ? 'plugin' : 'investor', needs_fresh: ['kite'], urgency: i.severity === 'critical' ? 'today' : 'this_week',
        expect: m.expect(r, profile),
      }, { edition }));
    }
  }
  return out;
}

module.exports = { evaluate, MAP };
