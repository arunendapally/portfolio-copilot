'use strict';
// Tasks (spec 002 data-model section 5): one decision the investor makes in a review run.
// The id hashes the situation, not the day, so the same gap keeps its id and a deferred task is
// not proposed again before its defer_until.

const crypto = require('crypto');

const PRIORITY = { gtt_gap: 1, gtt_policy: 1, profit_lock_arm: 2, profit_lock_book: 2, profit_lock_trail: 2, tripwire: 3, limit_stock: 4, limit_sector: 4, limit_fund_house: 4, drift: 5, contribution: 6, reentry_flag: 7, tax_budget: 7, data: 7 };
const CAP = 5;

function taskId(kind, symbol, ruleRef, bucket) {
  return `t_${crypto.createHash('sha1').update([kind, symbol || '', ruleRef || '', bucket === undefined ? '' : String(bucket)].join('|')).digest('hex').slice(0, 12)}`;
}

// executor: who acts. The lite edition never places orders, so its plugin tasks become the investor's.
function executorFor(wanted, edition) {
  if (wanted === 'plugin' && edition === 'lite') return 'investor';
  return wanted;
}

function make(t, { edition = 'full' } = {}) {
  const priority = t.priority || (t.kind === 'tripwire' && t.on_tripwire === 'exit' ? 1 : PRIORITY[t.kind] || 7);
  return {
    id: taskId(t.kind, t.symbol, t.rule_ref, t.bucket),
    kind: t.kind, symbol: t.symbol || null, priority, title: t.title,
    why: { rule_ref: t.rule_ref, measurements: t.measurements || [], findings: t.findings || [] },
    options: t.options || [{ id: 'do', label: t.do_label || 'Do it' }, { id: 'nothing', label: 'Do nothing' }],
    executor: executorFor(t.executor || 'investor', edition),
    urgency: t.urgency || 'this_week', needs_fresh: t.needs_fresh || [],
    decision: null, decided_at: null, reason: null, defer_until: null,
    draft_code: null, manual_steps: null, outcome: null, verified_at: null,
    expect: t.expect || { kind: 'none' },
  };
}

// Order by priority (then symbol, for a stable list), drop tasks deferred past today, cap at five.
function select(tasks, { deferred = {}, today, live = [] } = {}) {
  const seen = new Set();
  const open = tasks.filter((t) => {
    if (seen.has(t.id)) return false;
    seen.add(t.id);
    const until = deferred[t.id];
    return !(until && today && until > today);
  });
  open.sort((a, b) => a.priority - b.priority || String(a.symbol).localeCompare(String(b.symbol)) || a.id.localeCompare(b.id));
  for (const t of open) {
    const stale = t.needs_fresh.filter((b) => !live.includes(b));
    if (stale.length) t.not_executable = `needs a fresh read of ${stale.join(', ')}`;
  }
  return { tasks: open.slice(0, CAP), also_due: Math.max(0, open.length - CAP) };
}

module.exports = { PRIORITY, CAP, taskId, make, select, executorFor };
