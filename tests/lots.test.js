'use strict';
// Spec 002 US8 (T096): FIFO lots from made-up CSVs, reconciliation, short and long term per lot,
// the exemption left, and sell options that say "tax not computed" without statements.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { tmpEnv, writeProfile } = require('./helpers');
const { callTool } = require('../core/tools');
const lotsLib = require('../core/lib/lots');
const P = require('../core/lib/profile');
const effects = require('../core/lib/effects');
const snapshotLib = require('../core/lib/snapshot');
const taxBudget = require('../core/lib/rules/tax_budget');

const NOW = new Date('2026-11-16T05:00:00Z');
const TAX = { as_of: '2026-04-01', ltcg_exemption_inr: 125000, ltcg_pct: 12.5, stcg_pct: 20, fy_start_month: 4 };

function csv(dir, name, text) {
  const p = path.join(dir, name);
  fs.writeFileSync(p, text);
  return p;
}

function book(root) {
  const tb = csv(root, 'tradebook.csv', [
    'symbol,isin,trade_date,exchange,trade_type,quantity,price',
    'ALPHA,INE000000001,2024-06-03,NSE,buy,10,100',
    'ALPHA,INE000000001,2026-02-02,NSE,buy,10,150',
    'ALPHA,INE000000001,2026-07-01,NSE,sell,5,200',
    'BETA,INE000000002,2026-05-04,NSE,buy,4,500',
  ].join('\n'));
  const mf = csv(root, 'mf.csv', ['isin,scheme,date,transaction_type,units,nav', 'INF000000009,Some Index Fund,2025-01-10,Purchase,100,50'].join('\n'));
  return { tb, mf };
}

test('lots are built first-in first-out, realised gains counted for the financial year, and reconciled', () => {
  const { root } = tmpEnv();
  const { tb, mf } = book(root);
  const lots = lotsLib.build({ tradebook: tb, mfStatement: mf, held: { ALPHA: 15, BETA: 3, INF000000009: 100 }, now: NOW });
  assert.deepStrictEqual(lots.symbols.ALPHA.lots, [{ date: '2024-06-03', qty: 5, cost: 100 }, { date: '2026-02-02', qty: 10, cost: 150 }]);
  assert.strictEqual(lots.realised.fy, '2026-27');
  assert.strictEqual(lots.realised.ltcg_inr, 500, '5 sold from the 2024 lot: held over a year');
  assert.strictEqual(lots.realised.stcg_inr, 0);
  assert.strictEqual(lots.symbols.ALPHA.reconciled, true);
  assert.strictEqual(lots.symbols.BETA.reconciled, false, 'held 3, statements say 4');
  assert.strictEqual(lots.symbols.INF000000009.reconciled, true);
});

test('a sell uses lots in order, each short or long term, with the exemption left and the tax', () => {
  const { root } = tmpEnv();
  const { tb } = book(root);
  const lots = lotsLib.build({ tradebook: tb, held: { ALPHA: 15 }, now: NOW });
  const prof = P.merge(P.DEFAULTS, { tax: TAX });
  const t = lotsLib.taxFor(lots, prof, 'ALPHA', 8, 220, NOW);
  assert.deepStrictEqual(t.lots.map((l) => [l.date, l.qty, l.term]), [['2024-06-03', 5, 'long'], ['2026-02-02', 3, 'short']]);
  assert.strictEqual(t.ltcg_inr, 600);
  assert.strictEqual(t.stcg_inr, 210);
  assert.strictEqual(t.exemption_used_inr, 600);
  assert.strictEqual(t.exemption_left_inr, 125000 - 500 - 600);
  assert.strictEqual(t.amount_inr, 42, '20% of 210 short-term; long-term inside the exemption');
  assert.match(t.text, /rates as of 2026-04-01\); confirm with your tax adviser/);
});

test('without saved rates the lots still show and the tax says it is not computed', () => {
  const { root } = tmpEnv();
  const { tb } = book(root);
  const lots = lotsLib.build({ tradebook: tb, held: { ALPHA: 15 }, now: NOW });
  const t = lotsLib.taxFor(lots, P.merge(P.DEFAULTS, {}), 'ALPHA', 2, 220, NOW);
  assert.strictEqual(t.computed, false);
  assert.match(t.note, /2024-06-03 ×2 long .*tax not computed: save your rates/);
});

test('with no statements a sell option says tax not computed and still works', () => {
  const prof = P.merge(P.DEFAULTS, {});
  const snap = { taken_at: NOW.toISOString(), fx: {}, brokers: { kite: { holdings: [{ symbol: 'ALPHA', type: 'equity', qty: 10, ltp: 200, value: 2000, currency: 'INR' }], cash: 0 } } };
  const e = effects.forOption({ sell: { symbol: 'ALPHA', qty: 5 } }, { snap, c: snapshotLib.consolidate(snap, prof), profile: prof });
  assert.strictEqual(e.tax.computed, false);
  assert.match(e.tax.note, /tax not computed: load your tradebook/);
  assert.strictEqual(e.allocation.length, 2);
});

test('lots_build reports what does not reconcile; only CSV files are read', async () => {
  const { root, folder } = tmpEnv();
  writeProfile(folder, { schema_version: 2, tax: TAX });
  const { tb } = book(root);
  const r = await callTool('lots_build', { folder, tradebook_csv: tb }, { edition: 'full', now: () => NOW });
  assert.ok(r.ok, r.text);
  assert.ok(fs.existsSync(path.join(folder, 'portfolio-copilot', 'lots.json')));
  assert.match(r.text, /confirm with your tax adviser/);
  const bad = await callTool('lots_build', { folder, tradebook_csv: path.join(root, 'tradebook.xlsx') }, { edition: 'full', now: () => NOW });
  assert.strictEqual(bad.ok, false);
});

test('tax budget: near the year end, unused exemption beside long-term gains held', () => {
  const { root } = tmpEnv();
  const { tb } = book(root);
  const lots = lotsLib.build({ tradebook: tb, held: { ALPHA: 15 }, now: NOW });
  const prof = P.merge(P.DEFAULTS, { tax: TAX });
  const snap = { taken_at: '2027-02-15T05:00:00Z', brokers: { kite: { holdings: [{ symbol: 'ALPHA', type: 'equity', qty: 15, ltp: 220 }] } } };
  const [t] = taxBudget.evaluate({ profile: prof, lots, snap, now: new Date('2027-02-15T05:00:00Z'), edition: 'full' });
  assert.ok(t);
  assert.strictEqual(t.why.measurements[0].value, 124500);
  assert.match(t.options[0].label, /confirm with your tax adviser/);
  assert.deepStrictEqual(taxBudget.evaluate({ profile: prof, lots, snap, now: NOW, edition: 'full' }), [], 'not before the last two months');
});
