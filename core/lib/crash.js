'use strict';
// Crash mode: which stage of the investor's own deployment plan the index has reached,
// and which stops would force-sell names the investor intends to keep.

function stageReached(plan, indexLevel) {
  const stages = [...(plan.stages || [])].sort((a, b) => b.level - a.level);
  let reached = null;
  stages.forEach((s, i) => { if (indexLevel <= s.level) reached = { number: i + 1, ...s }; });
  const rows = stages.map((s, i) => ({ number: i + 1, ...s, reached: indexLevel <= s.level, done: !!s.done_at }));
  // Stages already deployed (done_at) are never drafted again (issue #6).
  return { reached, pending: rows.filter((s) => s.reached && !s.done), stages: rows };
}

// auditRows from gtt.audit; returns hold names whose stop is above the crash floor.
function stopReview(auditRows, policy) {
  return auditRows
    .filter((r) => r.class === 'hold' && !r.issues.some((i) => i.code === 'stop_kept') && r.stop !== null && r.stop_distance_pct !== null && r.stop_distance_pct < policy.min_stop_distance_pct)
    .map((r) => ({ symbol: r.symbol, stop: r.stop, distance_pct: r.stop_distance_pct, proposal: `analyze first: if the company is strong and the fall is macro, widen to about ${policy.crash_floor_pct}% below price; if the company is weakening, keep the stop and let it exit (never tighten in a fall)` }));
}

module.exports = { stageReached, stopReview };
