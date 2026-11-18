'use strict';
// Tripwires (spec 002 US5 scenario 3): a sourced, dated finding that crosses a saved tripwire for
// the required number of periods proposes the path written in the verdict. No sourced figure, no
// card: not_found and blocked_source never trigger.

const tasks = require('../tasks');

const KIND_PATH = { exit: 'Exit as your verdict says', reduce: 'Reduce as your verdict says', review: 'Review the thesis' };

// Latest accepted finding per (symbol, metric, period), in submission order.
function latestBy(findings) {
  const m = new Map();
  for (const f of findings) m.set(`${f.symbol}|${f.metric}|${f.period}`, f);
  return [...m.values()];
}

function crossed(t, f) {
  if (t.below !== undefined && t.below !== null) return f.value < t.below;
  return f.value > t.above;
}

function evaluate({ profile, findings = [], snap, edition }) {
  const held = new Map();
  for (const b of Object.values((snap && snap.brokers) || {})) for (const h of b.holdings || []) held.set(h.symbol, (held.get(h.symbol) || 0) + h.qty);
  const found = latestBy(findings).filter((f) => f.status === 'found' && typeof f.value === 'number');
  const out = [];
  for (const [sym, v] of Object.entries(profile.verdicts || {})) {
    if (!held.has(sym) || !Array.isArray(v.tripwires)) continue;
    for (const t of v.tripwires) {
      const n = t.for_quarters || 1;
      const recent = found.filter((f) => f.symbol === sym && f.metric === t.metric).slice(-n);
      if (recent.length < n || !recent.every((f) => crossed(t, f))) continue;
      const on = v.on_tripwire || 'review';
      out.push(tasks.make({
        kind: 'tripwire', on_tripwire: on, symbol: sym, rule_ref: `verdicts.${sym}.tripwires.${t.id || t.metric}`, bucket: recent.map((f) => f.period).join(','),
        title: `${sym}: tripwire ${t.id || t.metric} crossed`,
        measurements: recent.map((f) => ({ name: f.metric, value: f.value, base: `${f.period}, ${t.below !== undefined && t.below !== null ? `below ${t.below}` : `above ${t.above}`}`, as_of: f.accessed })),
        findings: recent.map((f) => ({ period: f.period, value: f.value, source_url: f.source_url, source_quote: f.source_quote || null, accessed: f.accessed })),
        options: [{ id: 'do', label: KIND_PATH[on] || KIND_PATH.review, ...(on === 'exit' ? { sell: { symbol: sym, qty: held.get(sym) } } : {}) }, { id: 'nothing', label: 'Keep holding; record why' }],
        executor: 'investor', urgency: on === 'exit' ? 'today' : 'this_week', expect: { kind: 'none' },
      }, { edition }));
    }
  }
  return out;
}

module.exports = { evaluate, latestBy };
