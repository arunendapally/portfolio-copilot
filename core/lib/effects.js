'use strict';
// What an option does to the book (spec 002 data-model section 5, option.effects): the drift it
// causes or closes, and its capital-gains cost when the investor's lots are loaded (US8).

const snapshotLib = require('./snapshot');

const round = (n, d = 1) => (n === null || n === undefined ? null : Math.round(n * 10 ** d) / 10 ** d);

function holdingOf(snap, symbol) {
  for (const b of Object.values(snap.brokers || {})) for (const h of b.holdings || []) if (h.symbol === symbol) return h;
  return null;
}

// Selling `value` of `symbol` moves it from its bucket into cash.
function sellAllocation(c, profile, h, value) {
  const book = c.totals.book;
  if (!book || !h) return [];
  const bucket = snapshotLib.bucketOf(h, profile);
  const row = (b) => c.allocation.find((a) => a.bucket === b) || { value: 0, target_pct: null };
  return [[bucket, -value], ['cash', value]].map(([b, d]) => {
    const r = row(b);
    return { bucket: b, before_pct: round((100 * r.value) / book), after_pct: round((100 * (r.value + d)) / book), target_pct: r.target_pct ?? null };
  });
}

// taxFor(symbol, qty, price) -> tax effect, supplied by the lots module when lots are loaded.
function forOption(opt, { snap, c, profile, taxFor }) {
  if (opt.sell) {
    const h = holdingOf(snap, opt.sell.symbol);
    const price = opt.sell.price || (h && h.ltp) || null;
    const qty = opt.sell.qty || (opt.sell.value && price ? Math.floor(opt.sell.value / price) : null);
    const value = qty && price ? qty * price : opt.sell.value || null;
    return {
      allocation: value ? sellAllocation(c, profile, h, value) : [],
      tax: taxFor && qty ? taxFor(opt.sell.symbol, qty, price) : { computed: false, note: 'tax not computed: load your tradebook (lots_build) to see the capital-gains cost' },
      concentration: [],
    };
  }
  if (opt.new_money) return { allocation: [], tax: { computed: true, amount_inr: 0, note: 'no sale, no tax' }, concentration: [] };
  return { allocation: [], tax: { computed: true, amount_inr: 0, note: 'no sale, no tax' }, concentration: [] };
}

function attach(tasks, ctx) {
  for (const t of tasks) for (const o of t.options) if (o.id !== 'nothing') o.effects = forOption(o, ctx);
  return tasks;
}

// One line for the propose text.
function line(e) {
  if (!e) return '';
  const drift = e.allocation.length ? e.allocation.map((a) => `${a.bucket.replace(/_/g, ' ')} ${a.before_pct}% → ${a.after_pct}%${a.target_pct !== null ? ` (target ${a.target_pct}%)` : ''}`).join(', ') : 'none on allocation';
  const tax = e.tax ? (e.tax.computed ? (e.tax.text || (e.tax.amount_inr ? `tax about ${e.tax.amount_inr} INR` : e.tax.note)) : e.tax.note) : '';
  return `Effect: ${drift}; ${tax}`;
}

module.exports = { attach, forOption, line, sellAllocation };
