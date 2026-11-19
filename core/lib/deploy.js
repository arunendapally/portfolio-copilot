'use strict';
// Deployment split (issue #38): broker cash into the investor's own destinations, tilted by
// valuation and setup. It decides nothing and places nothing: the result is the input to
// draft_basket, and the investor's own saved weights are the starting point.
//   1. keep_cash stays (play cash, buffer).
//   2. The global gap (target less held, INR) goes first, as a transfer to the global broker.
//   3. The rest splits by each destination's saved weight times a valuation tilt (index P/E against
//      its median, 0.5 to 1.5); the weights are renormalised.
//   4. Gold and silver go in halves (stage_metals); a Stretched or Downtrend setup takes half.
//      The held-back part stays cash. For Stretched names it can be offered as a dip LIMIT at the
//      20-day low with a deadline; that is a proposal for the investor, never an order.

const { round } = require('./format');
const { tick } = require('./gtt');

const TILT_MIN = 0.5;
const TILT_MAX = 1.5;
const HAIRCUT = 0.5;
const DEFAULT_DIP_DAYS = 14;

const isMetal = (d) => d.bucket === 'gold' || d.bucket === 'silver' || /GOLD|SILVER/i.test(d.symbol);
const tilt = (v) => (v && v.pe > 0 && v.median_pe > 0 ? Math.min(TILT_MAX, Math.max(TILT_MIN, v.median_pe / v.pe)) : 1);

function split({ cash, keep_cash = 0, global_gap_inr = 0, destinations, valuations = {}, setups = {}, sup20 = {}, prices = {}, stage_metals = true, dip_days = DEFAULT_DIP_DAYS, today }) {
  const deployable = Math.max(0, cash - keep_cash);
  const toGlobal = Math.min(Math.max(0, global_gap_inr), deployable);
  const rest = deployable - toGlobal;
  const tilted = destinations.map((d) => ({ d, w: d.weight_pct * tilt(valuations[d.symbol]) }));
  const sum = tilted.reduce((a, x) => a + x.w, 0) || 1;
  const rows = tilted.map(({ d, w }) => {
    const planned = (rest * w) / sum;
    const why = [];
    const t = tilt(valuations[d.symbol]);
    why.push(valuations[d.symbol] ? `valuation tilt x${round(t, 2)} (P/E ${valuations[d.symbol].pe} vs median ${valuations[d.symbol].median_pe})` : 'no valuation given, tilt x1');
    let keep = 1;
    const setup = setups[d.symbol] || null;
    if (setup === 'Stretched' || setup === 'Downtrend') { keep = HAIRCUT; why.push(`${setup}: half now`); }
    if (stage_metals && isMetal(d)) { keep = Math.min(keep, HAIRCUT); why.push('metal: staged in halves'); }
    const now = planned * keep;
    const row = { symbol: d.symbol, setup, planned: round(planned), amount_now: round(now), held_back: round(planned - now), why };
    if (setup === 'Stretched' && planned - now > 0 && typeof sup20[d.symbol] === 'number' && today) {
      const until = new Date(`${today}T00:00:00Z`);
      until.setUTCDate(until.getUTCDate() + dip_days);
      const price = tick(sup20[d.symbol]);
      row.dip_limit = { symbol: d.symbol, price, qty: Math.floor((planned - now) / price), valid_until: until.toISOString().slice(0, 10), note: 'proposal only; the investor decides whether to place it' };
    }
    return row;
  });
  const investNow = rows.reduce((a, r) => a + r.amount_now, 0);
  const destinationsOut = investNow > 0 ? rows.filter((r) => r.amount_now > 0).map((r) => ({ symbol: r.symbol, weight_pct: round((100 * r.amount_now) / investNow, 2) })) : [];
  // Rounding must not leave the weights off 100: the draft refuses weights that do not sum to it.
  if (destinationsOut.length) {
    const drift = round(100 - destinationsOut.reduce((a, x) => a + x.weight_pct, 0), 2);
    destinationsOut[0].weight_pct = round(destinationsOut[0].weight_pct + drift, 2);
  }
  return {
    cash, keep_cash, deployable: round(deployable), to_global: round(toGlobal), rest: round(rest),
    rows, invest_now: round(investNow), held_back: round(rows.reduce((a, r) => a + r.held_back, 0)),
    cash_after: round(cash - toGlobal - investNow), destinations: destinationsOut,
    dip_limits: rows.filter((r) => r.dip_limit).map((r) => r.dip_limit),
  };
}

module.exports = { split, tilt, TILT_MIN, TILT_MAX, HAIRCUT, DEFAULT_DIP_DAYS };
