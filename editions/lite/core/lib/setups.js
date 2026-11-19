'use strict';
// Technical setup per symbol (issue #34), from the engine's own closes (technicals.js). A state
// appears only when the averages it needs exist; nothing is estimated. R:R is the room to the
// 52-week high over the room down to the 20-day low, both from the same closes.

const STATES = ['In uptrend', 'Dip in uptrend', 'Stretched', 'Downtrend', 'Short history'];
const STRETCH_ABOVE_DMA50_PCT = 10;
const STRETCH_RSI = 70;

function classify(tech, ltp) {
  if (!tech || typeof ltp !== 'number' || typeof tech.dma50 !== 'number') return 'Short history';
  const floor = typeof tech.dma200 === 'number' ? tech.dma200 : tech.dma50;
  if (ltp < floor) return 'Downtrend';
  if (ltp < tech.dma50) return 'Dip in uptrend';
  if (ltp > tech.dma50 * (1 + STRETCH_ABOVE_DMA50_PCT / 100) || (typeof tech.rsi === 'number' && tech.rsi >= STRETCH_RSI)) return 'Stretched';
  return 'In uptrend';
}

function rr(tech, ltp) {
  if (!tech || typeof ltp !== 'number' || typeof tech.sup20 !== 'number' || typeof tech.hi52 !== 'number') return null;
  const risk = ltp - tech.sup20;
  const reward = tech.hi52 - ltp;
  if (risk <= 0 || reward <= 0) return null;
  return Math.round((reward / risk) * 100) / 100;
}

// symbols: [{ symbol, ltp }]; techs: { SYMBOL: technicals.compute(...) }
function rows(symbols, techs) {
  return symbols.map(({ symbol, ltp }) => {
    const t = techs[symbol] || null;
    return { symbol, ltp: typeof ltp === 'number' ? ltp : null, setup: classify(t, ltp), rr: rr(t, ltp), closes: t ? t.closes : 0, as_of: t ? t.as_of : null, dma50: t ? t.dma50 : null, dma200: t ? t.dma200 : null, rsi: t ? t.rsi : null, sup20: t ? t.sup20 : null, hi52: t ? t.hi52 : null };
  });
}

module.exports = { classify, rr, rows, STATES, STRETCH_ABOVE_DMA50_PCT, STRETCH_RSI };
