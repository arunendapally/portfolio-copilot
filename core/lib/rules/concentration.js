'use strict';
// Limits (spec 002 FR-033, FR-034): single stock, sector and fund house, each with its base named.
// Sector funds count toward a sector when the investor's sector map lists them.

const tasks = require('../tasks');
const snapshotLib = require('../snapshot');

const round = (n, d = 2) => (n === null || n === undefined ? null : Math.round(n * 10 ** d) / 10 ** d);
const BASES = {
  direct_equity: { label: 'direct equity (stocks at all brokers)', pick: (h) => h.type === 'equity' },
  kite_listed: { label: 'stocks and funds listed at Kite', pick: (h) => h.broker === 'kite' && (h.type === 'equity' || h.type === 'etf') },
  book: { label: 'whole book (holdings plus cash)', pick: () => true },
};

// Sector exposure on the profile's base. Returns rows { sector, value, pct, base }.
function sectorExposure(snap, profile, c) {
  const baseKey = profile.limits.sector_base || 'direct_equity';
  const base = BASES[baseKey];
  const holdings = snapshotLib.allHoldings(snap).filter(base.pick);
  const denom = baseKey === 'book' ? c.totals.book : holdings.reduce((a, h) => a + (h.value_inr || 0), 0);
  const by = {};
  for (const h of holdings) {
    const s = profile.sectors[h.symbol];
    if (!s) continue;
    by[s] = (by[s] || 0) + (h.value_inr || 0);
  }
  return Object.entries(by).map(([sector, value]) => ({ sector, value: round(value), pct: denom ? round((100 * value) / denom) : null, base: base.label, denom }))
    .sort((a, b) => b.value - a.value);
}

function evaluate({ snap, profile, c, edition }) {
  if (!snap || !c) return [];
  const L = profile.limits;
  const at = snap.taken_at;
  const out = [];
  const card = (kind, symbol, rule, title, value, pct, limit, base, denom, sellable = false) => {
    const excess = round(value - (limit / 100) * denom, 0);
    out.push(tasks.make({
      kind, symbol, rule_ref: rule, bucket: Math.floor(pct),
      title, measurements: [{ name: 'share_pct', value: pct, base, as_of: at }, { name: 'limit_pct', value: limit, base }, { name: 'excess_inr', value: excess, base: `value above ${limit}% of ${base}` }],
      options: [{ id: 'do', label: `Bring it back to ${limit}% (about ${excess} INR to reduce or to dilute with new money)`, ...(sellable ? { sell: { symbol, value: excess } } : {}) }, { id: 'nothing', label: 'Keep it above the limit' }],
      executor: 'investor', urgency: 'this_week', expect: { kind: 'none' },
    }, { edition }));
  };
  for (const p of c.positions.filter((x) => x.type === 'equity' && x.pct_of_book > L.single_stock_pct)) {
    card('limit_stock', p.symbol, 'limits.single_stock_pct', `${p.symbol} is above your single-stock limit`, p.value, p.pct_of_book, L.single_stock_pct, 'whole book (holdings plus cash)', c.totals.book, true);
  }
  for (const s of sectorExposure(snap, profile, c).filter((x) => x.pct !== null && x.pct > L.sector_pct)) {
    card('limit_sector', s.sector, 'limits.sector_pct', `${s.sector} is above your sector limit`, s.value, s.pct, L.sector_pct, s.base, s.denom);
  }
  const mf = c.fund_houses.reduce((a, h) => a + h.value, 0);
  for (const h of c.fund_houses.filter((x) => x.house !== 'UNKNOWN' && x.pct_of_mf > L.fund_house_pct)) {
    card('limit_fund_house', h.house, 'limits.fund_house_pct', `${h.house} funds are above your fund-house limit`, h.value, h.pct_of_mf, L.fund_house_pct, 'mutual fund holdings', mf);
  }
  return out;
}

module.exports = { evaluate, sectorExposure, BASES };
