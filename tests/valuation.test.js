'use strict';
// Spec 002 US3 (T043): prices carry their time, frozen holdings are valued at zero, the fresher
// price wins across brokers, a fund at two brokers is one position, same-day buys count for GTTs.
const test = require('node:test');
const assert = require('node:assert');
const P = require('../core/lib/profile');
const snapshotLib = require('../core/lib/snapshot');
const gtt = require('../core/lib/gtt');
const norm = require('../core/lib/brokers/normalize');
const { fixture } = require('./helpers');

const profile = (over = {}) => P.merge(P.DEFAULTS, over);
const h = (o) => ({ exchange: 'NSE', type: 'equity', qty: 10, avg: 100, ltp: 120, value: 1200, pnl: 200, currency: 'INR', ...o });
const snap = (brokers, at = '2026-11-16T05:00:00Z') => ({ taken_at: at, brokers, fx: {} });

test('every holding carries price_as_of and price_source', () => {
  const s = snapshotLib.valuate(snap({ kite: { as_of: '2026-11-16T05:00:00Z', holdings: [h({ symbol: 'A' })] }, kotak: { as_of: '2026-11-16T04:00:00Z', holdings: [h({ symbol: 'B' })] } }), null, profile());
  assert.strictEqual(s.brokers.kite.holdings[0].price_as_of, '2026-11-16T05:00:00Z');
  assert.strictEqual(s.brokers.kotak.holdings[0].price_source, 'kotak (previous close)');
});

test('a holding frozen at cost for two runs is valued at zero and listed separately; an override wins', () => {
  const frozen = h({ symbol: 'FROZENCO', ltp: 100, value: 1000 });
  const prev = snap({ kotak: { as_of: '2026-11-15T05:00:00Z', holdings: [{ ...frozen }] } }, '2026-11-15T05:00:00Z');
  const s = snapshotLib.valuate(snap({ kotak: { as_of: '2026-11-16T05:00:00Z', holdings: [{ ...frozen }] } }), prev, profile());
  assert.strictEqual(s.brokers.kotak.holdings[0].frozen, true);
  assert.strictEqual(s.brokers.kotak.holdings[0].value, 0);
  const c = snapshotLib.consolidate(s, profile());
  assert.ok(c.notes.some((n) => /valued at zero.*FROZENCO/.test(n)));
  const once = snapshotLib.valuate(snap({ kotak: { as_of: '2026-11-16T05:00:00Z', holdings: [{ ...frozen }] } }), null, profile());
  assert.ok(!once.brokers.kotak.holdings[0].frozen, 'one run at cost is not frozen');
  const o = snapshotLib.valuate(snap({ kotak: { as_of: '2026-11-16T05:00:00Z', holdings: [{ ...frozen }] } }), prev, profile({ valuation_overrides: { FROZENCO: 0 } }));
  assert.strictEqual(o.brokers.kotak.holdings[0].price_source, 'profile override');
});

test('the fresher price is used for an instrument held at two brokers', () => {
  const s = snapshotLib.valuate(snap({
    kite: { as_of: '2026-11-16T05:00:00Z', holdings: [h({ symbol: 'SBIN', isin: 'INE062A01020', ltp: 1010 })] },
    kotak: { as_of: '2026-11-15T10:00:00Z', holdings: [h({ symbol: 'SBIN', isin: 'INE062A01020', ltp: 990 })] },
  }), null, profile());
  assert.strictEqual(s.brokers.kotak.holdings[0].ltp, 1010);
  assert.strictEqual(s.brokers.kotak.holdings[0].value, 10100);
  assert.strictEqual(s.brokers.kotak.holdings[0].price_source, 'kite');
});

test('a fund at two brokers is one position (ISIN, or normalised name)', () => {
  const mf = (o) => h({ type: 'mf', exchange: 'MF', ...o });
  const c = snapshotLib.consolidate(snap({
    kite: { holdings: [mf({ symbol: 'INF846K01DP8', isin: 'INF846K01DP8', name: 'Axis Liquid Fund Direct Growth' })] },
    kotak: { holdings: [mf({ symbol: 'AXIS LIQUID FUND - DIRECT PLAN - GROWTH', isin: 'INF846K01DP8' })] },
  }), profile());
  const axis = c.positions.filter((p) => p.type === 'mf');
  assert.strictEqual(axis.length, 1);
  assert.deepStrictEqual(axis[0].brokers, ['kite', 'kotak']);
  assert.strictEqual(snapshotLib.positionKey(mf({ name: 'Axis Liquid Fund - Direct Plan - Growth' })), snapshotLib.positionKey(mf({ name: 'AXIS LIQUID FUND DIRECT GROWTH' })));
});

test('same-day buys from positions count toward GTT coverage and are labelled today', () => {
  const pos = norm.kitePositions(fixture('kite-gen2/positions.json'));
  assert.deepStrictEqual(pos.map((p) => [p.symbol, p.day_qty]), [['ALPHA', 10]]);
  const s = snap({ kite: { as_of: '2026-11-16T05:00:00Z', holdings: [h({ symbol: 'ALPHA', qty: 5, ltp: 560 })], positions: pos, gtts: [{ id: 1, symbol: 'ALPHA', status: 'active', triggers: [400], legs: [{ side: 'SELL', trigger: 400, qty: 15 }] }] } });
  const a = gtt.audit(s, null, profile());
  const row = a.rows.find((r) => r.symbol === 'ALPHA');
  assert.strictEqual(row.qty, 15);
  assert.ok(row.issues.some((i) => i.code === 'today_buy_counted'));
  assert.ok(!row.issues.some((i) => i.code === 'qty_short'));
});
