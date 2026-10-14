'use strict';
// Trade audit: today's fills and between-session quantity increases checked against the
// investor's own verdicts, cash rule and concentration limits.

const { verdictOf } = require('./profile');

const NO_BUY = { exit: 'EXIT', reduce: 'REDUCE', hold_no_add: 'HOLD, DO NOT ADD' };

function tradeAudit(snap, consolidated, diffResult, profile) {
  const findings = [];
  const buys = [];
  for (const [broker, b] of Object.entries(snap.brokers || {})) {
    for (const o of b.orders || []) {
      if ((o.filled_qty || 0) > 0) buys.push({ broker, symbol: o.symbol, side: o.side, qty: o.filled_qty, via_gtt: o.via_gtt, when: 'today' });
    }
  }
  for (const c of diffResult.changes || []) {
    if (c.change > 0 && c.cause.startsWith('between sessions')) buys.push({ broker: c.broker, symbol: c.symbol, side: 'BUY', qty: c.change, via_gtt: false, when: 'between sessions' });
  }
  for (const t of buys) {
    if (t.side !== 'BUY') continue;
    const v = verdictOf(profile, t.symbol);
    if (NO_BUY[v.stance]) {
      findings.push({ level: 'critical', symbol: t.symbol, text: `Bought ${t.qty} ${t.symbol} (${t.when}${t.via_gtt ? ', via GTT' : ''}); your verdict is ${NO_BUY[v.stance]}${v.reason ? `: ${v.reason}` : ''}` });
    }
    const pos = consolidated.positions.find((p) => p.symbol === t.symbol);
    if (pos && pos.type === 'equity' && pos.pct_of_book > profile.limits.single_stock_pct) {
      findings.push({ level: 'warn', symbol: t.symbol, text: `${t.symbol} is now ${pos.pct_of_book}% of book after a buy (limit ${profile.limits.single_stock_pct}%)` });
    }
    if (consolidated.cash.below_buffer) {
      findings.push({ level: 'warn', symbol: t.symbol, text: `Bought ${t.symbol} while cash is below the ${profile.cash.buffer_min_pct}% buffer` });
    }
  }
  return { checked: buys.length, findings };
}

module.exports = { tradeAudit };
