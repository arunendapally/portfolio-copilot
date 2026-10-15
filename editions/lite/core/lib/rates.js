'use strict';
// Default rate-sensitivity map by sector or instrument class. Profile rate_overrides win.

const SECTOR_DEFAULT = {
  nbfc: 'most', 'consumer finance': 'most', autos: 'most', 'consumer durables': 'most', realty: 'most', 'capital goods': 'mixed',
  banks: 'mixed', financials: 'mixed', insurance: 'mixed',
  pharma: 'least', it: 'least', energy: 'least', psu: 'least', utilities: 'least', fmcg: 'least', metals: 'mixed',
};

const SYMBOL_PATTERNS = [
  [/^(MID|SMALL|HDFCSML|MIDCAP|NEXT50)|MID150|SML250/, 'most', 'mid/small-cap index'],
  [/GILT|LIQUID|BOND|SDL|DEBT/, 'most', 'duration debt'],
  [/^(MON100|MAFANG|NASDAQ|HNGSNG)|^N100/, 'least', 'foreign equity'],
  [/GOLD|SILVER/, 'mixed', 'precious metals'],
  [/^(NIFTYBEES|JUNIORBEES|SETFNIF50|BANKBEES)$/, 'mixed', 'large-cap index'],
];

function classify(symbol, type, profile) {
  const sym = symbol.toUpperCase();
  if (profile.rate_overrides[sym]) return { bucket: profile.rate_overrides[sym], basis: 'your override' };
  if (type === 'foreign') return { bucket: 'least', basis: 'foreign equity' };
  for (const [re, bucket, basis] of SYMBOL_PATTERNS) if (re.test(sym)) return { bucket, basis };
  const sector = (profile.sectors[sym] || '').toLowerCase();
  if (sector && SECTOR_DEFAULT[sector]) return { bucket: SECTOR_DEFAULT[sector], basis: `sector: ${sector}` };
  return { bucket: 'unknown', basis: sector ? `sector ${sector} not in default map` : 'no sector on file' };
}

module.exports = { classify, SECTOR_DEFAULT };
