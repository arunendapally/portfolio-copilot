#!/usr/bin/env node
'use strict';
// Runs the local collectors (spec 002 US7): on demand, or once per trading day at a set time.
// A collector that needs a login records it and does nothing else; status reports it.
//
//   node local/collect.js --folder <investor folder>                 pull now, then refresh
//   node local/collect.js --folder <dir> --daily 08:45               once per weekday at 08:45 IST
//   node local/collect.js --login kite --request-token <token>       finish today's Kite login

const path = require('path');
const fs = require('fs');
const collectors = require('./collectors');
const { callTool, makeContext } = require('../core/tools');
const { configDir } = require('../core/lib/state');
const session = require('../core/lib/session');

const needsFile = () => path.join(configDir(), 'local-needs.json');

function recordNeeds(needs) {
  require('../core/lib/state').writeJson(needsFile(), needs, 0o600);
}

function readNeeds() {
  try { return JSON.parse(fs.readFileSync(needsFile(), 'utf8')); } catch { return {}; }
}

function make(deps = {}) {
  return Object.fromEntries(collectors.BROKERS.map((b) => [b, (deps.collectors && deps.collectors[b]) || collectors.load(b, deps)]));
}

// IBKR joins the snapshot through ingest, with the INR rate from the same Flex report when present.
async function ingestIbkr(folder, ctx) {
  const pos = session.read('ibkr', 'holdings');
  const bal = session.read('ibkr', 'balances');
  if (!pos || !pos.ok || !bal || !bal.ok) return null;
  const rows = JSON.parse(pos.text);
  const b = JSON.parse(bal.text);
  const usd = (b.rates || []).find((r) => r.from === 'USD');
  const cashUsd = (b.cash || []).filter((x) => x.currency === 'USD').reduce((a, x) => a + x.ending_cash, 0);
  const holdings = rows.map((p) => ({ symbol: p.symbol, qty: p.qty, ltp: p.market_price, value: p.market_value, avg: p.avg_cost, pnl: p.unrealized_pnl, currency: p.currency, type: p.asset === 'STK' ? 'etf' : 'foreign' }));
  if (!usd) return { ok: false, text: 'IBKR read, but the Flex report has no USD to INR rate: add Conversion Rates to the query. IBKR is left out of totals until then.' };
  return callTool('ingest', { folder, broker: 'ibkr', holdings, cash: cashUsd, currency: 'USD', fx_rate: usd.rate, fx_source: `IBKR Flex conversion rate, ${usd.date || 'report date'}`, source: 'IBKR Flex (local engine)' }, ctx);
}

async function runAll(folder, { brokers, deps = {}, ctx = makeContext() } = {}) {
  const all = make(deps);
  const out = {};
  const needs = {};
  for (const [b, col] of Object.entries(all)) {
    if (brokers && !brokers.includes(b)) continue;
    const st = await col.status();
    if (st.state === 'needs_login') { needs[b] = st; out[b] = { state: 'needs_login', detail: st.detail }; continue; }
    if (st.state !== 'ready') { out[b] = { state: st.state, detail: st.detail }; continue; }
    const r = await col.pull();
    out[b] = { state: r.state, written: r.written, errors: r.errors };
    if (r.state === 'needs_login') needs[b] = await col.status();
  }
  recordNeeds(needs);
  const refresh = await callTool('refresh', { folder }, ctx);
  const ibkr = out.ibkr && out.ibkr.written && out.ibkr.written.length ? await ingestIbkr(folder, ctx) : null;
  return { brokers: out, needs, refresh, ibkr };
}

async function login(broker, input, deps = {}) {
  const col = make(deps)[broker];
  if (!col) return { state: 'error', detail: `no collector for ${broker}` };
  const r = await col.login(input);
  if (r.state === 'ready') { const n = readNeeds(); delete n[broker]; recordNeeds(n); }
  return r;
}

async function status(deps = {}) {
  const all = make(deps);
  const out = {};
  for (const [b, col] of Object.entries(all)) out[b] = await col.status();
  return out;
}

function istNow(d = new Date()) {
  const t = new Date(d.getTime() + 5.5 * 3600 * 1000);
  return { day: t.toISOString().slice(0, 10), hhmm: t.toISOString().slice(11, 16), weekday: t.getUTCDay() };
}

async function daily(folder, at) {
  let last = null;
  const tick = async () => {
    const n = istNow();
    if (n.weekday === 0 || n.weekday === 6 || n.hhmm < at || last === n.day) return;
    const r = await runAll(folder);
    // A login need is recorded and nothing else is tried until the next hour.
    if (Object.keys(r.needs).length) return;
    last = n.day;
  };
  await tick();
  setInterval(tick, 60 * 60 * 1000);
}

async function main() {
  const a = {};
  for (let i = 2; i < process.argv.length; i += 2) a[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];
  if (a.login) { console.log(JSON.stringify(await login(a.login, { request_token: a['request-token'] }))); return; }
  if (!a.folder) { console.error('Usage: node local/collect.js --folder <investor folder> [--daily HH:MM] | --login kite --request-token <token>'); process.exit(1); }
  if (a.daily) { await daily(a.folder, a.daily); return; }
  const r = await runAll(a.folder);
  console.log(Object.entries(r.brokers).map(([b, s]) => `${b}: ${s.state}${s.errors && s.errors.length ? ` (${s.errors.join('; ')})` : ''}`).join('\n'));
  console.log(r.refresh.text.split('\n').slice(0, 8).join('\n'));
}

if (require.main === module) main().catch((e) => { console.error(e.message); process.exit(1); });
module.exports = { runAll, login, status, readNeeds, ingestIbkr };
