'use strict';
// Tax budget (spec 002 T098): in the last two months of the financial year, show how much of the
// investor's long-term exemption is unused beside the long-term gains they hold. Information for
// a decision, not a recommendation; it says to confirm with an adviser.

const tasks = require('../tasks');
const lotsLib = require('../lots');
const { istDate } = require('../format');

const WINDOW_DAYS = 60;

function fyEnd(now, startMonth) {
  const [yy, mm] = istDate(now).split('-').map(Number);
  const y = mm >= startMonth ? yy + 1 : yy;
  return new Date(Date.UTC(y, startMonth - 1, 1));
}

function notSet(profile) {
  return lotsLib.ratesSet(profile.tax) ? [] : ['tax rates and exemption'];
}

function evaluate({ profile, lots, snap, now, edition }) {
  if (!lots || !lotsLib.ratesSet(profile.tax) || !snap) return [];
  const end = fyEnd(now, profile.tax.fy_start_month || 4);
  if ((end - now) / 86400000 > WINDOW_DAYS) return [];
  const realised = lotsLib.realisedThisFy(lots, profile.tax, now);
  const fy = lotsLib.fyOf(istDate(now), profile.tax.fy_start_month || 4);
  const left = Math.max(0, profile.tax.ltcg_exemption_inr - realised.ltcg_inr);
  if (!left) return [];
  let longGains = 0;
  const price = new Map();
  for (const b of Object.values(snap.brokers || {})) for (const h of b.holdings || []) if (h.ltp) price.set(h.symbol, h.ltp);
  for (const [sym, s] of Object.entries(lots.symbols)) {
    const p = price.get(sym);
    if (!p) continue;
    for (const l of s.lots) if ((now - new Date(`${l.date}T00:00:00Z`)) / 86400000 > 365 && p > l.cost) longGains += l.qty * (p - l.cost);
  }
  if (longGains <= 0) return [];
  return [tasks.make({
    kind: 'tax_budget', symbol: null, rule_ref: 'tax.ltcg_exemption_inr', bucket: fy,
    title: `${Math.round(left)} INR of your long-term exemption is unused this year`,
    measurements: [
      { name: 'exemption_left_inr', value: Math.round(left), base: `your saved exemption (as of ${profile.tax.as_of}) less long-term gains realised in ${fy}${realised.note ? ` (${realised.note})` : ''}`, as_of: snap.taken_at },
      { name: 'long_term_gains_held_inr', value: Math.round(longGains), base: 'lots held over a year, at last price' },
      { name: 'year_ends', value: end.toISOString().slice(0, 10), base: 'your financial year' },
    ],
    options: [{ id: 'do', label: `Review it before the year ends (${lotsLib.ADVISER})` }, { id: 'nothing', label: 'Leave it' }],
    executor: 'investor', urgency: 'this_month', expect: { kind: 'none' },
  }, { edition })];
}

module.exports = { evaluate, notSet, fyEnd };
