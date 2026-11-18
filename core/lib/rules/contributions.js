'use strict';
// Plan path (spec 002 US5 scenario 4): the book is compared with the investor's own path (start
// value, monthly amounts with a yearly step-up, expected return). Behind by more than the
// tolerance: a card shows the extra monthly amount that closes the gap in 12 months.

const tasks = require('../tasks');

const REQUIRED = ['start', 'start_book_inr', 'return_pct', 'behind_tolerance_pct'];

function monthsBetween(a, b) {
  return (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
}

// The monthly amount saved for a month (YYYY-MM): the last schedule entry at or before it,
// stepped up each year in step_up_month.
function contributionFor(plan, ym) {
  const entries = (plan.monthly || []).filter((m) => m.from <= ym && typeof m.amount_inr === 'number').sort((a, b) => a.from.localeCompare(b.from));
  const e = entries[entries.length - 1];
  if (!e) return 0;
  let amount = e.amount_inr;
  if (plan.step_up_pct && plan.step_up_month) {
    const [y0, m0] = e.from.split('-').map(Number);
    const [y, m] = ym.split('-').map(Number);
    let steps = 0;
    for (let yy = y0; yy <= y; yy++) {
      const stepAt = yy * 12 + plan.step_up_month;
      if (stepAt > y0 * 12 + m0 && stepAt <= y * 12 + m) steps++;
    }
    amount *= (1 + plan.step_up_pct / 100) ** steps;
  }
  return amount;
}

function pathValue(plan, now) {
  const start = new Date(`${plan.start}T00:00:00Z`);
  const r = plan.return_pct / 100 / 12;
  let v = plan.start_book_inr;
  const n = monthsBetween(start, now);
  for (let i = 1; i <= n; i++) {
    const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1));
    v = v * (1 + r) + contributionFor(plan, d.toISOString().slice(0, 7));
  }
  return v;
}

// Extra per month for 12 months, growing at the plan return, that adds up to the gap.
function extraMonthly(gap, returnPct) {
  const r = returnPct / 100 / 12;
  let factor = 0;
  for (let k = 0; k < 12; k++) factor += (1 + r) ** k;
  return Math.round(gap / factor);
}

function notSet(profile) {
  const p = profile.plan || {};
  return REQUIRED.some((k) => p[k] === null || p[k] === undefined) ? ['plan path'] : [];
}

function evaluate({ profile, c, now, snap, edition }) {
  if (notSet(profile).length || !c || !c.totals.book) return [];
  const p = profile.plan;
  const path = pathValue(p, now);
  const behindPct = (100 * (path - c.totals.book)) / path;
  if (behindPct <= p.behind_tolerance_pct) return [];
  const gap = Math.round(path - c.totals.book);
  const extra = extraMonthly(gap, p.return_pct);
  return [tasks.make({
    kind: 'contribution', symbol: null, rule_ref: 'plan.behind_tolerance_pct', bucket: Math.floor(behindPct),
    title: `The book is ${Math.round(behindPct * 10) / 10}% behind your plan path`,
    measurements: [
      { name: 'book_inr', value: Math.round(c.totals.book), base: 'whole book (holdings plus cash)', as_of: snap.taken_at },
      { name: 'plan_path_inr', value: Math.round(path), base: `your plan from ${p.start} at ${p.return_pct}% a year` },
      { name: 'extra_monthly_inr', value: extra, base: 'added each month for 12 months closes the gap' },
    ],
    options: [{ id: 'do', label: `Raise the monthly amount by about ${extra} INR for 12 months` }, { id: 'nothing', label: 'Keep the plan as it is' }],
    executor: 'investor', urgency: 'this_month', expect: { kind: 'none' },
  }, { edition })];
}

module.exports = { evaluate, notSet, pathValue, extraMonthly, contributionFor };
