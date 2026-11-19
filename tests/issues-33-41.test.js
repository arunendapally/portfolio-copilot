'use strict';
// Issues #33 to #41: setups, watchlist, deployment split, basket JSON, intraday plan and retro,
// play losses on the check, close_session.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { tmpEnv, fixture, writeProfile, fakeBrokers, ctxAt } = require('./helpers');
const { callTool } = require('../core/tools');
const setups = require('../core/lib/setups');
const deploy = require('../core/lib/deploy');
const intraday = require('../core/lib/intraday');
const charges = require('../core/lib/charges');

const T = { dma50: 100, dma200: 90, rsi: 55, sup20: 95, hi52: 130 };

test('setup states follow the averages and RSI; R:R is room up over room down', () => {
  assert.strictEqual(setups.classify(T, 105), 'In uptrend');
  assert.strictEqual(setups.classify(T, 99), 'Dip in uptrend');
  assert.strictEqual(setups.classify(T, 85), 'Downtrend');
  assert.strictEqual(setups.classify(T, 111), 'Stretched');
  assert.strictEqual(setups.classify({ ...T, rsi: 72 }, 105), 'Stretched');
  assert.strictEqual(setups.classify(null, 105), 'Short history');
  assert.strictEqual(setups.classify({ ...T, dma50: null }, 105), 'Short history');
  assert.strictEqual(setups.rr(T, 105), 2.5);
  assert.strictEqual(setups.rr(T, 94), null);
  assert.strictEqual(setups.rr({ ...T, hi52: null }, 105), null);
});

test('closes_seed gives a held symbol its history so setups can classify it', async () => {
  const { folder } = tmpEnv();
  writeProfile(folder, { ...fixture('profile.json'), brokers: { kite: { enabled: true }, kotak: { enabled: false } } });
  const ctx = ctxAt('2026-10-14T05:00:00Z', fakeBrokers({ kite: { data: fixture('kite-book.json') } }));
  await callTool('refresh', { folder }, ctx);
  const rows = Array.from({ length: 259 }, (_, i) => ({ date: new Date(Date.UTC(2025, 9, 1 + i)).toISOString().slice(0, 10), close: 100 + i * 0.5 }));
  const s = await callTool('closes_seed', { folder, symbol: 'icicibank', rows }, ctx);
  assert.ok(s.ok, s.text);
  const r = await callTool('setups', { folder, symbols: ['ICICIBANK', 'NOHISTORY'] }, ctx);
  const icici = r.rows.find((x) => x.symbol === 'ICICIBANK');
  assert.ok(icici.closes >= 250 && icici.dma200 !== null && icici.hi52 !== null);
  assert.ok(setups.STATES.includes(icici.setup) && icici.setup !== 'Short history');
  assert.strictEqual(r.rows.find((x) => x.symbol === 'NOHISTORY').setup, 'Short history');
  const bad = await callTool('closes_seed', { folder, symbol: 'X', rows: [{ date: '14-10-2026', close: 5 }] }, ctx);
  assert.strictEqual(bad.ok, false);
});

test('watchlist keeps names and saved screens in the profile and says they are not recommendations', async () => {
  const { folder } = tmpEnv();
  writeProfile(folder, fixture('profile.json'));
  const ctx = ctxAt('2026-11-19T05:00:00Z', fakeBrokers());
  let r = await callTool('watchlist', { folder, action: 'add', symbol: 'tcs', note: 'results due' }, ctx);
  assert.ok(r.ok, r.text);
  assert.deepStrictEqual(r.watchlist.symbols.map((x) => [x.symbol, x.added, x.source]), [['TCS', '2026-11-19', 'investor']]);
  assert.match(r.text, /not recommendations/);
  r = await callTool('watchlist', { folder, action: 'save_screen', name: 'quality', url: 'https://www.screener.in/screen/raw/?q=roce' }, ctx);
  assert.strictEqual(r.watchlist.screens.length, 1);
  r = await callTool('watchlist', { folder, action: 'record_results', name: 'quality', symbols: ['infy', 'tcs'] }, ctx);
  assert.deepStrictEqual(r.watchlist.symbols.map((x) => x.symbol), ['TCS', 'INFY']);
  assert.strictEqual(r.watchlist.symbols[1].source, 'screen:quality');
  assert.strictEqual(r.watchlist.screens[0].last_run, '2026-11-19');
  const kept = JSON.parse(fs.readFileSync(path.join(folder, 'portfolio-copilot', 'profile.json'), 'utf8'));
  assert.strictEqual(kept.watchlist.symbols.length, 2);
  r = await callTool('watchlist', { folder, action: 'remove', symbol: 'TCS' }, ctx);
  assert.deepStrictEqual(r.watchlist.symbols.map((x) => x.symbol), ['INFY']);
  r = await callTool('watchlist', { folder, action: 'save_screen', name: 'x' }, ctx);
  assert.strictEqual(r.ok, false);
});

test('deployment split: global gap first, valuation tilt, metals in halves, held-back stays cash', () => {
  const r = deploy.split({
    cash: 100000, keep_cash: 10000, global_gap_inr: 20000,
    destinations: [{ symbol: 'NIFTYBEES', weight_pct: 60 }, { symbol: 'GOLDBEES', weight_pct: 40 }],
    valuations: { NIFTYBEES: { pe: 20, median_pe: 25 } },
  });
  assert.strictEqual(r.to_global, 20000);
  assert.strictEqual(r.rest, 70000);
  const [n, g] = r.rows;
  assert.ok(Math.abs(n.planned - 45652.17) < 0.02 && n.amount_now === n.planned, `${n.planned}`);
  assert.ok(Math.abs(g.planned - 24347.83) < 0.02 && Math.abs(g.amount_now - 12173.91) < 0.02);
  assert.ok(Math.abs(r.invest_now - 57826.09) < 0.03);
  assert.ok(Math.abs(r.cash_after - 22173.91) < 0.03);
  assert.strictEqual(Math.round(r.destinations.reduce((a, x) => a + x.weight_pct, 0) * 100) / 100, 100);
  assert.ok(r.rows.every((x) => !x.dip_limit));
});

test('a Stretched name takes half now and offers a dip limit at the 20-day low with a deadline', () => {
  const r = deploy.split({
    cash: 100000, destinations: [{ symbol: 'NIFTYBEES', weight_pct: 100 }], setups: { NIFTYBEES: 'Stretched' }, sup20: { NIFTYBEES: 200 }, today: '2026-11-19',
  });
  const x = r.rows[0];
  assert.ok(Math.abs(x.amount_now - 50000) < 0.01 && Math.abs(x.held_back - 50000) < 0.01);
  assert.deepStrictEqual(r.dip_limits, [{ symbol: 'NIFTYBEES', price: 200, qty: 250, valid_until: '2026-12-03', note: 'proposal only; the investor decides whether to place it' }]);
  const down = deploy.split({ cash: 100000, destinations: [{ symbol: 'A', weight_pct: 100 }], setups: { A: 'Downtrend' }, sup20: { A: 50 }, today: '2026-11-19' });
  assert.strictEqual(down.dip_limits.length, 0);
});

test('deploy refuses with no cash and no destinations; draft_basket can write the Kite import file', async () => {
  const { folder } = tmpEnv();
  writeProfile(folder, { ...fixture('profile.json'), brokers: { kite: { enabled: true }, kotak: { enabled: false } } });
  const ctx = ctxAt('2026-10-14T05:00:00Z', fakeBrokers({ kite: { data: fixture('kite-book.json') } }));
  assert.strictEqual((await callTool('deploy', { folder }, ctx)).ok, false);
  await callTool('refresh', { folder }, ctx);
  const d = await callTool('deploy', { folder, cash: 50000 }, ctx);
  assert.ok(d.ok, d.text);
  assert.ok(d.invest_now > 0 && d.invest_now <= 50000);
  const b = await callTool('draft_basket', { folder, amount: d.amount, destinations: d.destinations, format: 'kite_json' }, ctx);
  assert.ok(b.ok, b.text);
  const f = path.join(folder, 'portfolio-copilot', 'baskets', `basket-${b.code}.json`);
  const rows = JSON.parse(fs.readFileSync(f, 'utf8'));
  assert.ok(rows.length > 0);
  assert.deepStrictEqual(Object.keys(rows[0]), ['instrument', 'params']);
  assert.deepStrictEqual(rows[0].instrument, { exchange: 'NSE', tradingsymbol: rows[0].instrument.tradingsymbol });
  assert.strictEqual(rows[0].params.order_type, 'LIMIT');
  assert.strictEqual(rows[0].params.product, 'CNC');
  assert.match(b.text, /format unverified/);
  const plain = await callTool('draft_basket', { folder, amount: d.amount, destinations: d.destinations }, ctx);
  assert.doesNotMatch(plain.text, /Kite import file/);
});

const at = (m) => new Date(Date.UTC(2026, 10, 19, 3, 45 + 5 * m)).toISOString();
const CANDLES = [[100, 101, 99.5, 100.5], [100.5, 102, 100, 101.5], [101.5, 102.5, 101, 102], [102, 103, 101.8, 102.8], [102.8, 103.5, 102.5, 103.2], [103.2, 104, 103, 103.8]]
  .map((x, k) => ({ t: at(k), o: x[0], h: x[1], l: x[2], c: x[3], v: 1000 }));

test('intraday plan: structure stop, quantity from the risk, charges netted, default rates flagged', () => {
  const p = intraday.plan({ candles: CANDLES, risk_inr: 4400 }, { charges: null });
  assert.ok(p.ok);
  assert.deepStrictEqual([p.entry, p.stop, p.target, p.qty], [103.8, 99.4, 112.6, 1000]);
  assert.deepStrictEqual([p.levels.or_low, p.levels.or_high], [99.5, 102.5]);
  assert.ok(Math.abs(p.charges_at_target - 86.3) < 0.05);
  assert.strictEqual(p.net_rr, 1.94);
  assert.strictEqual(p.default_rates, true);
  const short = intraday.plan({ candles: CANDLES, side: 'short', entry: 110, risk_inr: 1000 }, {});
  assert.strictEqual(short.ok, false);
  assert.strictEqual(intraday.plan({ candles: CANDLES.slice(0, 2), risk_inr: 100 }, {}).ok, false);
  assert.strictEqual(intraday.plan({ candles: CANDLES, risk_inr: 1 }, {}).ok, false);
});

test("the investor's own charge rates replace the default and drop the flag", () => {
  const own = { as_of: '2026-11-01', source: 'broker calculator', intraday: { brokerage_pct: 0, brokerage_cap_inr: 0, stt_sell_pct: 0, txn_pct: 0, sebi_pct: 0, stamp_buy_pct: 0, gst_pct: 0 }, delivery: charges.DEFAULT.delivery };
  const c = charges.roundTrip({ qty: 100, buy: 100, sell: 101, product: 'MIS' }, { charges: own });
  assert.deepStrictEqual([c.total, c.default_rates, c.rates_source], [0, false, 'broker calculator']);
});

test('intraday calls are logged, watched on prices, and replayed against later candles', async () => {
  const { folder } = tmpEnv();
  writeProfile(folder, { ...fixture('profile.json'), loss_tolerance: { amount_inr: 25000, from: '2026-11-01', to: null, measure: 'realised_plus_open' } });
  const ctx = ctxAt('2026-11-19T04:30:00Z', fakeBrokers());
  const a = await callTool('intraday_plan', { folder, symbol: 'AAA', candles: CANDLES, risk_inr: 4400, log: true }, ctx);
  const b = await callTool('intraday_plan', { folder, symbol: 'BBB', candles: CANDLES, risk_inr: 4400, log: true }, ctx);
  const c = await callTool('intraday_plan', { folder, symbol: 'CCC', candles: CANDLES, risk_inr: 4400, log: true }, ctx);
  assert.deepStrictEqual([a.call.id, b.call.id], ['IC-2026-11-19-1', 'IC-2026-11-19-2']);
  const w = await callTool('intraday_watch', { folder, prices: { AAA: 99, BBB: 113, CCC: 105 } }, ctx);
  assert.deepStrictEqual(w.calls.map((x) => x.state), ['stop hit', 'target hit', 'open']);
  const candles = {
    AAA: [{ t: at(12), o: 103, h: 103.5, l: 99, c: 99.5, v: 1 }],
    BBB: [{ t: at(12), o: 104, h: 113, l: 103.5, c: 112, v: 1 }],
    CCC: [{ t: at(12), o: 104, h: 113, l: 99, c: 100, v: 1 }],
  };
  const r = await callTool('retro', { folder, candles }, ctx);
  const by = Object.fromEntries(r.results.map((x) => [x.symbol, x]));
  assert.strictEqual(by.AAA.outcome, 'stopped');
  assert.ok(Math.abs(by.AAA.net - (-4400 - 82.53)) < 0.05, `${by.AAA.net}`);
  assert.strictEqual(by.BBB.outcome, 'target');
  assert.ok(Math.abs(by.BBB.net - (8800 - 86.3)) < 0.05, `${by.BBB.net}`);
  assert.strictEqual(by.CCC.outcome, 'stopped', 'a candle touching both counts as stopped');
  assert.strictEqual(r.won, 1);
  assert.strictEqual(r.lost, 2);
  assert.match(r.text, /tolerance 25,?000|₹25,000/);
  assert.match((await callTool('retro', { folder, date: '2026-11-18' }, ctx)).text, /No intraday calls/);
});

test('check shows open play losses against the loss tolerance only once it is saved', async () => {
  const { folder } = tmpEnv();
  const base = { ...fixture('profile.json'), brokers: { kite: { enabled: true }, kotak: { enabled: false } } };
  const ctx = ctxAt('2026-10-14T05:00:00Z', fakeBrokers({ kite: { data: fixture('kite-book.json') } }));
  writeProfile(folder, base);
  const without = await callTool('refresh', { folder }, ctx);
  assert.doesNotMatch(without.text, /Play losses \(open\)/);
  writeProfile(folder, { ...base, loss_tolerance: { amount_inr: 25000, from: null, to: null, measure: 'realised_plus_open' } });
  const withIt = await callTool('check', { folder }, ctx);
  assert.match(withIt.text, /Play losses \(open\)/);
  assert.match(withIt.text, /realised needs your tradebook/);
});

test('close_session saves a dated summary and refuses a folder with no profile', async () => {
  const { folder } = tmpEnv();
  const ctx = ctxAt('2026-11-19T10:00:00Z', fakeBrokers());
  const no = await callTool('close_session', { folder, decisions: ['kept GOLDBEES'] }, ctx);
  assert.strictEqual(no.ok, false);
  assert.match(no.text, /uploaded copy or the wrong folder/);
  writeProfile(folder, fixture('profile.json'));
  const empty = await callTool('close_session', { folder }, ctx);
  assert.strictEqual(empty.ok, false);
  const r = await callTool('close_session', { folder, decisions: ['kept GOLDBEES'], trades: ['bought 10 NIFTYBEES'], start_here: 'Next: top up GTTs' }, ctx);
  assert.ok(r.ok, r.text);
  const text = fs.readFileSync(path.join(folder, 'portfolio-copilot', 'log.md'), 'utf8');
  assert.match(text, /Next: top up GTTs/);
  assert.match(text, /\*\*Decisions\*\*\n- kept GOLDBEES/);
  assert.match(text, /\*\*Trades\*\*\n- bought 10 NIFTYBEES/);
  assert.match(r.text, /Project/);
});

test('profile validation rejects a malformed watchlist and charges', () => {
  const profiles = require('../core/lib/profile');
  const bad = profiles.merge(profiles.DEFAULTS, { watchlist: { symbols: [{ note: 'x' }], screens: [{}] }, charges: { intraday: {} } });
  const errs = profiles.validate(bad);
  assert.ok(errs.some((e) => /watchlist.symbols\[0\]/.test(e)));
  assert.ok(errs.some((e) => /watchlist.screens\[0\]/.test(e)));
  assert.ok(errs.some((e) => /^charges:/.test(e)));
  assert.deepStrictEqual(profiles.validate(profiles.DEFAULTS), []);
});

test('dashboard export carries setup and R:R per row and a watchlist file (issue #33)', async () => {
  const { root, folder } = tmpEnv();
  writeProfile(folder, { ...fixture('profile.json'), brokers: { kite: { enabled: true }, kotak: { enabled: false } }, watchlist: { symbols: [{ symbol: 'TCS', added: '2026-11-01', source: 'investor' }], screens: [{ name: 'quality', url: 'u', last_run: '2026-11-01', last_results: ['TCS'] }] } });
  const ctx = ctxAt('2026-10-14T05:00:00Z', fakeBrokers({ kite: { data: fixture('kite-book.json') } }));
  await callTool('refresh', { folder }, ctx);
  const out = path.join(root, 'dash');
  const r = await callTool('export', { folder, format: 'dashboard', out }, ctx);
  assert.ok(r.ok, r.text);
  const pos = JSON.parse(fs.readFileSync(path.join(out, 'positions-2026-10-14.json'), 'utf8'));
  assert.ok(pos.every((p) => 'setup' in p && 'rr' in p));
  assert.ok(pos.every((p) => p.setup === 'Short history' && p.rr === null), 'no history yet: said so, not guessed');
  const watch = JSON.parse(fs.readFileSync(path.join(out, 'watchlist-2026-10-14.json'), 'utf8'));
  assert.deepStrictEqual(watch.names.map((x) => [x.symbol, x.setup, x.ltp]), [['TCS', 'Short history', null]]);
  assert.deepStrictEqual(watch.screens, [{ name: 'quality', last_run: '2026-11-01', results: 1 }]);
});
