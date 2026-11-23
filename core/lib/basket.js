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

// Kite's basket import file (issue #39). The shape follows a basket exported from Kite web
// (instrument + params); no sample was available to check it against, so the draft says
// "unverified" until the investor confirms an import works.
function kiteJson(rows) {
  return rows.filter((r) => r.qty > 0).map((r) => ({
    instrument: { exchange: r.exchange || 'NSE', tradingsymbol: r.symbol },
    params: { transaction_type: 'BUY', order_type: 'LIMIT', product: 'CNC', validity: 'DAY', quantity: r.qty, price: r.limit_price },
  }));
}

module.exports = { build, kiteJson, LIMIT_BUFFER_PCT };
