'use strict';
// Allocation drift (spec 002 US5 scenario 1): a bucket outside its band gets a card that closes
// it with new money first and shows the amount. A bucket with a target but no band is "not set".

const tasks = require('../tasks');

const round = (n) => Math.round(n);

// New money that brings a bucket back to its target without selling.
// Underweight: (v + M) / (B + M) = t. Overweight: v / (B + M) = t (the money goes elsewhere).
function newMoney(value, book, targetPct) {
  const t = targetPct / 100;
  if (value / book < t) return t >= 1 ? null : round((t * book - value) / (1 - t));
  return t > 0 ? round(value / t - book) : null;
}

function evaluate({ c, profile, snap, edition }) {
  if (!c || !c.totals.book) return [];
  const bands = profile.allocation.bands_pp || {};
  const out = [];
  for (const a of c.allocation.filter((x) => x.target_pct !== null && x.drift_pp !== null)) {
    const band = bands[a.bucket];
    if (band === undefined || band === null) continue;
    if (Math.abs(a.drift_pp) <= band) continue;
    const under = a.drift_pp < 0;
    const money = newMoney(a.value, c.totals.book, a.target_pct);
    out.push(tasks.make({
      kind: 'drift', symbol: a.bucket, rule_ref: `allocation.bands_pp.${a.bucket}`, bucket: under ? 'under' : 'over',
      title: `${a.bucket.replace(/_/g, ' ')} is ${under ? 'below' : 'above'} its band`,
      measurements: [
        { name: 'share_pct', value: a.pct_of_book, base: 'whole book (holdings plus cash)', as_of: snap.taken_at },
        { name: 'target_pct', value: a.target_pct, base: 'whole book' },
        { name: 'band_pp', value: band, base: 'percentage points either side' },
        { name: 'new_money_inr', value: money, base: under ? `into ${a.bucket} to reach target` : `into other buckets to bring ${a.bucket} back to target` },
      ],
      options: [{ id: 'do', label: `Close it with new money first (about ${money} INR ${under ? `into ${a.bucket}` : 'elsewhere'})` }, { id: 'nothing', label: 'Leave the drift' }],
      executor: 'investor', urgency: 'this_month', expect: { kind: 'none' },
    }, { edition }));
  }
  return out;
}

function notSet(profile) {
  const bands = profile.allocation.bands_pp || {};
  const missing = Object.keys(profile.allocation.targets || {}).filter((b) => bands[b] === undefined || bands[b] === null);
  return missing.length ? [`drift bands (${missing.join(', ')})`] : [];
}

module.exports = { evaluate, notSet, newMoney };
