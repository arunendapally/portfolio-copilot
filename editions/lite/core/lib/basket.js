'use strict';
// Basket rows for manual entry in the broker's basket screen.

const { verdictOf } = require('./profile');
const { round } = require('./format');
const { tick } = require('./gtt');

const LIMIT_BUFFER_PCT = 0.3; // LIMIT slightly above last price

// destinations: [{ symbol, exchange, weight_pct }]; prices: { SYMBOL: ltp }
function build({ amount, destinations, prices, cash, profile }) {
  const rows = [];
  const conflicts = [];
  const missing = [];
  for (const d of destinations) {
    const sym = d.symbol.toUpperCase();
    const ltp = prices[sym];
    if (!ltp) { missing.push(sym); continue; }
    const v = verdictOf(profile, sym);
    if (['exit', 'reduce', 'hold_no_add'].includes(v.stance)) conflicts.push(`${sym}: verdict is ${v.stance.toUpperCase()}`);
    const limit = tick(ltp * (1 + LIMIT_BUFFER_PCT / 100));
    const target = (amount * d.weight_pct) / 100;
    const qty = Math.floor(target / limit);
    rows.push({ symbol: sym, exchange: d.exchange || 'NSE', qty, limit_price: limit, amount: round(qty * limit), target: round(target), basis: `${d.weight_pct}% of ${round(amount)} at LTP ${ltp} + ${LIMIT_BUFFER_PCT}%` });
  }
  const total = round(rows.reduce((a, r) => a + r.amount, 0));
  const cashLeft = cash === null || cash === undefined ? null : round(cash - total);
  if (cashLeft !== null && cashLeft < 0) conflicts.push(`basket total ${total} exceeds available broker cash ${round(cash)}`);
  return { rows, total, cash_left: cashLeft, conflicts, missing_prices: missing };
}

module.exports = { build, LIMIT_BUFFER_PCT };
