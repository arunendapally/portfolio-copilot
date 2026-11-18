'use strict';
// Lots and capital gains (spec 002 US8, data-model section 9). Built first-in first-out from the
// statements the investor imports (CSV only), reconciled to held quantity. Tax figures use the
// rates and exemption saved and dated in the profile; without them the lots and holding periods
// still show and the tax says it is not computed. Every tax line says to confirm with an adviser.

const fs = require('fs');
const path = require('path');
const { stateDir, readJson, writeJson } = require('./state');
const { parseDelimited, num } = require('./brokers/normalize');

const LONG_DAYS = 365;
const ADVISER = 'confirm with your tax adviser';
const file = (folder) => path.join(stateDir(folder), 'lots.json');
const day = (s) => new Date(`${String(s).slice(0, 10)}T00:00:00Z`);
const days = (a, b) => Math.floor((day(b) - day(a)) / 86400000);
const round = (n) => Math.round(n);

function csvRows(p) {
  const { headers, rows } = parseDelimited(fs.readFileSync(p, 'utf8'));
  const h = headers.map((x) => x.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''));
  return rows.map((r) => Object.fromEntries(h.map((k, i) => [k, String(r[i] ?? '').replace(/^"|"$/g, '').trim()])));
}

const pick = (r, keys) => { for (const k of keys) if (r[k] !== undefined && r[k] !== '') return r[k]; return ''; };

// Trades from a broker tradebook or a fund statement, normalised to { symbol, date, side, qty, price }.
function trades(p, kind) {
  return csvRows(p).map((r) => {
    const sideRaw = pick(r, ['trade_type', 'type', 'transaction_type', 'transaction', 'side']).toLowerCase();
    const side = /buy|purchase|sip|switch_in|switch in/.test(sideRaw) ? 'buy' : /sell|redemption|redeem|switch_out|switch out/.test(sideRaw) ? 'sell' : null;
    return {
      symbol: pick(r, kind === 'mf' ? ['isin', 'symbol', 'scheme', 'fund'] : ['symbol', 'tradingsymbol', 'isin']).toUpperCase(),
      date: pick(r, ['trade_date', 'date', 'transaction_date']).slice(0, 10),
      side, qty: Math.abs(num(pick(r, ['quantity', 'units', 'qty'])) || 0), price: num(pick(r, ['price', 'nav', 'rate'])),
    };
  }).filter((t) => t.symbol && t.side && t.qty && t.price !== null && /^\d{4}-\d{2}-\d{2}$/.test(t.date));
}

function fyOf(date, startMonth = 4) {
  const d = day(date);
  const y = d.getUTCMonth() + 1 >= startMonth ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
  return `${y}-${String((y + 1) % 100).padStart(2, '0')}`;
}

// FIFO through every trade; sells inside the current financial year add to realised gains.
function build({ tradebook, mfStatement, held = {}, now = new Date(), fyStartMonth = 4 }) {
  const all = [...(tradebook ? trades(tradebook, 'equity') : []), ...(mfStatement ? trades(mfStatement, 'mf') : [])]
    .sort((a, b) => a.date.localeCompare(b.date) || (a.side === 'buy' ? -1 : 1));
  const fy = fyOf(now.toISOString(), fyStartMonth);
  const symbols = {};
  const realised = { fy, stcg_inr: 0, ltcg_inr: 0 };
  const problems = [];
  for (const t of all) {
    const s = symbols[t.symbol] || (symbols[t.symbol] = { lots: [] });
    if (t.side === 'buy') { s.lots.push({ date: t.date, qty: t.qty, cost: t.price }); continue; }
    let left = t.qty;
    while (left > 0 && s.lots.length) {
      const lot = s.lots[0];
      const q = Math.min(left, lot.qty);
      if (fyOf(t.date, fyStartMonth) === fy) {
        const gain = q * (t.price - lot.cost);
        s.realised_fy_inr = (s.realised_fy_inr || 0) + gain;
        if (days(lot.date, t.date) > LONG_DAYS) realised.ltcg_inr += gain; else realised.stcg_inr += gain;
      }
      lot.qty -= q;
      left -= q;
      if (lot.qty <= 1e-9) s.lots.shift();
    }
    if (left > 1e-9) problems.push(`${t.symbol}: sold ${left} more than the statements bought (${t.date})`);
  }
  for (const [sym, s] of Object.entries(symbols)) {
    const qty = s.lots.reduce((a, l) => a + l.qty, 0);
    s.held_qty = held[sym] === undefined ? null : held[sym];
    s.reconciled = s.held_qty !== null && Math.abs(qty - s.held_qty) < 1e-6;
    s.lots_qty = qty;
  }
  realised.stcg_inr = round(realised.stcg_inr);
  realised.ltcg_inr = round(realised.ltcg_inr);
  return { schema_version: 1, built_at: now.toISOString(), sources: [tradebook, mfStatement].filter(Boolean).map((p) => path.basename(p)), symbols, realised, problems };
}

const load = (folder) => readJson(file(folder), null);
const save = (folder, lots) => { writeJson(file(folder), lots); return lots; };

function ratesSet(tax) {
  return tax && tax.as_of && typeof tax.stcg_pct === 'number' && typeof tax.ltcg_pct === 'number' && typeof tax.ltcg_exemption_inr === 'number';
}

// The tax effect of selling qty at price: lots used, holding periods, gains, exemption used.
function taxFor(lots, profile, symbol, qty, price, now = new Date()) {
  const s = lots && lots.symbols && lots.symbols[symbol];
  if (!s) return { computed: false, note: `tax not computed: no lots for ${symbol} (import statements with lots_build)` };
  const used = [];
  let left = qty;
  for (const l of s.lots) {
    if (left <= 0) break;
    const q = Math.min(left, l.qty);
    const held = days(l.date, now.toISOString());
    used.push({ date: l.date, qty: q, cost: l.cost, days_held: held, term: held > LONG_DAYS ? 'long' : 'short', gain_inr: round(q * (price - l.cost)) });
    left -= q;
  }
  const st = used.filter((u) => u.term === 'short').reduce((a, u) => a + u.gain_inr, 0);
  const lt = used.filter((u) => u.term === 'long').reduce((a, u) => a + u.gain_inr, 0);
  const lotsText = used.map((u) => `${u.date} ×${u.qty} ${u.term} (${u.days_held} days)`).join(', ');
  const base = { lots: used, stcg_inr: st, ltcg_inr: lt, realised_fy: lots.realised, uncovered_qty: left > 0 ? left : 0 };
  const tax = profile.tax || {};
  if (!ratesSet(tax)) return { ...base, computed: false, note: `lots ${lotsText}; short-term gain ${st} INR, long-term ${lt} INR; tax not computed: save your rates and exemption (tax.*) with their date; ${ADVISER}` };
  const remaining = Math.max(0, tax.ltcg_exemption_inr - Math.max(0, lots.realised.ltcg_inr));
  const exemptUsed = Math.min(remaining, Math.max(0, lt));
  const amount = round(Math.max(0, st) * tax.stcg_pct / 100 + Math.max(0, lt - exemptUsed) * tax.ltcg_pct / 100);
  return {
    ...base, computed: true, amount_inr: amount, exemption_used_inr: exemptUsed, exemption_left_inr: remaining - exemptUsed,
    text: `lots ${lotsText}; short-term gain ${st} INR, long-term ${lt} INR; uses ${exemptUsed} of the ${remaining} INR exemption left this year; tax about ${amount} INR (rates as of ${tax.as_of}); ${ADVISER}`,
  };
}

module.exports = { build, load, save, taxFor, trades, fyOf, ratesSet, ADVISER };
