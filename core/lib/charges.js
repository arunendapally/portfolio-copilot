'use strict';
// Round-trip charges on an equity trade (issues #36, #37). The rates are the investor's own:
// saved in profile.charges with the date and source. The fallback below is a default that may be
// out of date; every result that uses it says so. Confirm against the broker's charge calculator.

const DEFAULT = {
  as_of: null, source: 'built-in default, unverified',
  intraday: { brokerage_pct: 0.03, brokerage_cap_inr: 20, stt_sell_pct: 0.025, txn_pct: 0.00297, sebi_pct: 0.0001, stamp_buy_pct: 0.003, gst_pct: 18 },
  delivery: { brokerage_pct: 0, brokerage_cap_inr: 0, stt_sell_pct: 0.1, stt_buy_pct: 0.1, txn_pct: 0.00297, sebi_pct: 0.0001, stamp_buy_pct: 0.015, gst_pct: 18, dp_sell_inr: 15.34 },
};

const r2 = (n) => Math.round(n * 100) / 100;

function rates(profile) {
  const c = profile && profile.charges;
  if (c && c.intraday && c.delivery) return { ...c, default: false };
  return { ...DEFAULT, default: true };
}

// product: MIS (intraday) or CNC (delivery). Returns the total in INR and its parts.
function roundTrip({ qty, buy, sell, product = 'MIS' }, profile) {
  const R = rates(profile);
  const t = product === 'CNC' ? R.delivery : R.intraday;
  const bv = qty * buy;
  const sv = qty * sell;
  const leg = (v) => (t.brokerage_cap_inr ? Math.min(t.brokerage_cap_inr, (v * t.brokerage_pct) / 100) : (v * t.brokerage_pct) / 100);
  const brokerage = leg(bv) + leg(sv);
  const stt = (sv * t.stt_sell_pct) / 100 + (product === 'CNC' ? (bv * (t.stt_buy_pct || 0)) / 100 : 0);
  const txn = ((bv + sv) * t.txn_pct) / 100;
  const sebi = ((bv + sv) * t.sebi_pct) / 100;
  const stamp = (bv * t.stamp_buy_pct) / 100;
  const gst = ((brokerage + txn + sebi) * t.gst_pct) / 100;
  const dp = product === 'CNC' ? t.dp_sell_inr || 0 : 0;
  const total = brokerage + stt + txn + sebi + stamp + gst + dp;
  return { total: r2(total), per_share: qty ? r2(total / qty) : null, default_rates: R.default, rates_source: R.source, rates_as_of: R.as_of };
}

module.exports = { roundTrip, rates, DEFAULT };
