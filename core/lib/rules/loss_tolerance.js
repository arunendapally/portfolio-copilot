'use strict';
// Loss tolerance on play trades (spec 002 T079; open decision 2 answered 17-Nov-2026: realised
// plus open losses). Open losses come from the snapshot. Realised losses need the investor's
// tradebook (lots, US8); until it is loaded the card says so and counts open losses only, so it
// can fire late but never early.

const tasks = require('../tasks');

const classOf = (h, profile) => (profile.classes && profile.classes[h.symbol]) || (['etf', 'mf', 'foreign'].includes(h.type) ? 'core' : 'play');

function notSet(profile) {
  const l = profile.loss_tolerance || {};
  return l.amount_inr === null || l.amount_inr === undefined || !l.measure ? ['loss tolerance'] : [];
}

function evaluate({ snap, profile, realised = null, edition }) {
  if (notSet(profile).length || !snap) return [];
  const l = profile.loss_tolerance;
  let open = 0;
  for (const b of Object.values(snap.brokers || {})) {
    for (const h of b.holdings || []) if (classOf(h, profile) === 'play' && typeof h.pnl === 'number' && h.pnl < 0) open += -h.pnl;
  }
  const real = l.measure === 'realised' || l.measure === 'realised_plus_open' ? realised : null;
  const used = (l.measure === 'realised' ? 0 : open) + (real || 0);
  if (used <= l.amount_inr) return [];
  const realNote = real === null ? 'realised losses not counted: load your tradebook (lots) to include them' : `realised ${Math.round(real)} INR since ${l.from || 'the start'}`;
  return [tasks.make({
    kind: 'data', priority: 3, symbol: null, rule_ref: 'loss_tolerance.amount_inr', bucket: Math.floor(used / Math.max(1, l.amount_inr) * 10),
    title: 'Play-trade losses are past your tolerance',
    measurements: [
      { name: 'losses_inr', value: Math.round(used), base: `${l.measure === 'realised' ? 'realised' : 'realised plus open'} on play trades; ${realNote}`, as_of: snap.taken_at },
      { name: 'tolerance_inr', value: l.amount_inr, base: `your limit${l.from ? ` from ${l.from}` : ''}${l.to ? ` to ${l.to}` : ''}` },
    ],
    options: [{ id: 'do', label: 'Pause new play trades and review the open ones' }, { id: 'nothing', label: 'Carry on' }],
    executor: 'investor', urgency: 'this_week', expect: { kind: 'none' },
  }, { edition })];
}

module.exports = { evaluate, notSet, classOf };
