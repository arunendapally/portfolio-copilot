'use strict';
// Tool definitions and handlers. Every handler returns { ok, ..., text } where `text` is the
// compact rendering the model shows as is.

const fs = require('fs');
const state = require('./lib/state');
const profiles = require('./lib/profile');
const norm = require('./lib/brokers/normalize');
const snapshotLib = require('./lib/snapshot');
const { tradeAudit } = require('./lib/audit');
const gtt = require('./lib/gtt');
const drafts = require('./lib/drafts');
const basket = require('./lib/basket');
const crash = require('./lib/crash');
const rates = require('./lib/rates');
const log = require('./lib/log');
const { istStamp, istDate, inr, pct, table } = require('./lib/format');

const FOLDER = { folder: { type: 'string', description: "The investor's working folder (absolute path). Pass it on the first call; it is remembered." } };

function defaultBrokers() {
  return { kite: require('./lib/brokers/kite'), kotak: require('./lib/brokers/kotak') };
}

// ---------------------------------------------------------------------------------------

async function brokerStatus(args, ctx) {
  const { profile } = profiles.load(args.folder);
  const rows = [];
  const links = [];
  const out = {};
  for (const name of ['kite', 'kotak']) {
    if (!profile.brokers[name] || !profile.brokers[name].enabled) { out[name] = { status: 'disabled' }; continue; }
    const s = await ctx.brokers[name].status();
    out[name] = s;
    if (s.status === 'needs_login') {
      if (name === 'kite') {
        const l = await ctx.brokers.kite.login();
        if (l.ok) { s.link = l.link; links.push(`Zerodha: [log in to Kite](${l.link}) then say "done"`); }
        else s.error = l.error;
      } else if (profile.brokers.kotak.ucc) {
        const l = await ctx.brokers.kotak.loginStart(profile.brokers.kotak.ucc);
        if (l.ok) { s.link = l.link; links.push(`Kotak Neo: ${l.link ? `[open login](${l.link})` : 'check the Kotak app'}. ${l.instructions}`); }
        else s.error = l.error;
      } else s.error = 'No Kotak UCC on file: profile_update brokers.kotak.ucc';
    }
    rows.push([name, s.status, s.status === 'outage' ? `outage: ${s.detail}. Do not log in again; retry later.` : s.error || s.detail || s.user || '']);
  }
  if (profile.brokers.ibkr && profile.brokers.ibkr.enabled) rows.push(['ibkr', 'via connector', 'call get_account_summary (and positions) on the IBKR connector, then ingest']);
  const text = [`**Broker status** · ${istStamp(ctx.now())}`, table(['Broker', 'Status', 'Detail'], rows), links.length ? `\nLog in (links come straight from each broker's login tool):\n- ${links.join('\n- ')}` : ''].join('\n');
  return { ok: true, brokers: out, text };
}

async function brokerLogin(args, ctx) {
  const { profile } = profiles.load(args.folder);
  if (args.broker === 'kite') {
    const l = await ctx.brokers.kite.login();
    return l.ok ? { ok: true, link: l.link, text: `[Log in to Kite](${l.link}), then say "done".` } : { ok: false, error: l.error, text: l.error };
  }
  if (args.broker === 'kotak') {
    if (args.step === 'validate') {
      const v = await ctx.brokers.kotak.loginValidate();
      return v.ok ? { ok: true, text: 'Kotak Neo session validated.' } : { ok: false, error: v.error, text: `${v.error}${v.detail ? `: ${v.detail}` : ''}` };
    }
    const ucc = args.ucc || profile.brokers.kotak.ucc;
    const l = await ctx.brokers.kotak.loginStart(ucc);
    return l.ok ? { ok: true, link: l.link, text: `${l.link ? `[Open Kotak login](${l.link}). ` : ''}${l.instructions}` } : { ok: false, error: l.error, text: l.error };
  }
  return { ok: false, error: 'broker must be kite or kotak', text: 'broker must be kite or kotak' };
}

function todaySnapshot(folder, now) {
  return state.loadSnapshot(folder, istDate(now)) || { taken_at: now.toISOString(), brokers: {}, fx: {}, unverified: {} };
}

async function refresh(args, ctx) {
  const now = ctx.now();
  const { profile, errors } = profiles.load(args.folder);
  const date = istDate(now);
  const prev = state.previousSnapshot(args.folder, date) || state.loadSnapshot(args.folder, date);
  const snap = todaySnapshot(args.folder, now);
  snap.taken_at = now.toISOString();
  snap.unverified = snap.unverified || {};
  const pulled = [];
  for (const name of ['kite', 'kotak']) {
    if (args.brokers && !args.brokers.includes(name)) continue;
    if (!profile.brokers[name] || !profile.brokers[name].enabled) continue;
    const s = await ctx.brokers[name].status();
    let block = null;
    if (s.status === 'live') {
      try {
        if (name === 'kite') {
          const raw = await ctx.brokers.kite.fetchAll();
          const holdings = [...norm.kiteHoldings(raw.holdings, profile), ...norm.kiteMfHoldings(raw.mf)];
          const c = snapshotLib.floorCash(norm.kiteCash(raw.margins));
          block = { status: 'live', as_of: now.toISOString(), holdings, gtts: norm.kiteGtts(raw.gtts), orders: norm.kiteOrders(raw.orders), cash: c.cash, cash_note: c.note, mf_folio_count: holdings.filter((h) => h.type === 'mf').length };
        } else {
          const raw = await ctx.brokers.kotak.fetchAll(profile);
          const c = snapshotLib.floorCash(raw.cash);
          block = { status: 'live', as_of: now.toISOString(), holdings: raw.holdings, gtts: [], orders: [], cash: c.cash, cash_note: c.note, mf_folio_count: raw.holdings.filter((h) => h.type === 'mf').length };
        }
      } catch (e) {
        s.status = e.code === 'NEEDS_LOGIN' ? 'needs_login' : e.code === 'KOTAK_FORMAT' ? 'format_error' : 'outage';
        s.detail = e.message.slice(0, 200);
      }
    }
    const key = `${name}:verification`;
    if (block) {
      snap.brokers[name] = block;
      snap.unverified[key] = 0;
      pulled.push(name);
    } else {
      const carried = (snap.brokers[name] && snap.brokers[name].status === 'live' ? snap.brokers[name] : prev && prev.brokers[name]) || null;
      snap.brokers[name] = carried ? { ...carried, status: s.status, carried_from: carried.as_of } : { status: s.status, holdings: [], gtts: [], orders: [], cash: null };
      snap.brokers[name].detail = s.detail || null;
      snap.unverified[key] = ((prev && prev.unverified && prev.unverified[key]) || 0) + 1;
    }
  }
  state.saveSnapshot(args.folder, date, snap);
  const report = await check({ folder: args.folder }, ctx);
  if (errors.length) report.text = `Profile problems: ${errors.join('; ')}\n\n${report.text}`;
  return { ...report, pulled };
}

async function ingest(args, ctx) {
  const now = ctx.now();
  const { profile } = profiles.load(args.folder);
  const broker = String(args.broker || '').toLowerCase();
  if (!broker || ['kite', 'kotak'].includes(broker)) return { ok: false, error: 'ingest is for brokers core does not connect to (e.g. ibkr, or a statement import)', text: 'Use refresh for kite/kotak.' };
  let holdings;
  if (args.csv_path) {
    const parsed = norm.kotakHoldings(fs.readFileSync(args.csv_path, 'utf8'), profile);
    holdings = parsed.map((h) => ({ ...h, broker, currency: args.currency || 'INR' }));
  } else {
    holdings = (args.holdings || []).map((h) => {
      const qty = norm.num(h.qty ?? h.quantity ?? h.position) || 0;
      const ltp = norm.num(h.ltp ?? h.last_price ?? h.market_price);
      const value = norm.num(h.value ?? h.market_value) ?? (ltp !== null ? qty * ltp : null);
      const avg = norm.num(h.avg ?? h.average_price ?? h.avg_cost);
      return { broker, symbol: String(h.symbol).toUpperCase(), exchange: h.exchange || null, type: h.type || (args.currency && args.currency !== 'INR' ? 'foreign' : 'equity'), qty, avg, ltp, value, pnl: norm.num(h.pnl ?? h.unrealized_pnl) ?? (value !== null && avg !== null ? value - qty * avg : null), day_change: norm.num(h.day_change ?? h.daily_pnl), currency: h.currency || args.currency || 'INR' };
    }).filter((h) => h.qty);
  }
  const snap = todaySnapshot(args.folder, now);
  snap.taken_at = now.toISOString();
  snap.brokers[broker] = { status: 'live', as_of: now.toISOString(), holdings, gtts: [], orders: [], cash: norm.num(args.cash), cash_currency: args.currency || 'INR', source: args.source || (args.csv_path ? 'statement import' : 'connector') };
  if (args.currency && args.currency !== 'INR') {
    if (!args.fx_rate) return { ok: false, error: `fx_rate (INR per ${args.currency}) is required`, text: `Give fx_rate for ${args.currency}.` };
    snap.fx = snap.fx || {};
    snap.fx[args.currency] = { rate: Number(args.fx_rate), source: args.fx_source || 'not stated', as_of: now.toISOString() };
  }
  state.saveSnapshot(args.folder, istDate(now), snap);
  return { ok: true, broker, holdings: holdings.length, text: `Ingested ${holdings.length} ${broker} holdings${args.currency && args.currency !== 'INR' ? ` (${args.currency} at ${args.fx_rate} INR, ${args.fx_source || 'source not stated'})` : ''}.` };
}

function brokerLine(name, b, unverified) {
  const when = b.as_of ? istStamp(new Date(b.as_of)) : 'no data';
  if (b.status === 'live') return `${name}: live, data ${when}`;
  const u = unverified && unverified[`${name}:verification`];
  return `${name}: ${b.status.replace('_', ' ')}${b.carried_from ? `, showing data from ${istStamp(new Date(b.carried_from))}` : ', no data'}${u ? `, unverified ${u} run${u > 1 ? 's' : ''} in a row` : ''}`;
}

async function check(args, ctx) {
  const now = ctx.now();
  const { profile } = profiles.load(args.folder);
  const snap = state.latestSnapshot(args.folder);
  if (!snap) return { ok: false, error: 'no snapshot yet', text: 'No data yet. Run refresh first.' };
  const date = snap.taken_at ? istDate(new Date(snap.taken_at)) : istDate(now);
  const prev = state.previousSnapshot(args.folder, date);
  const c = snapshotLib.consolidate(snap, profile);
  const d = snapshotLib.diff(prev, snap);
  const t = tradeAudit(snap, c, d, profile);
  const L = [];
  L.push(`**Portfolio check** · ${istStamp(now)}`);
  L.push(Object.entries(snap.brokers).map(([n, b]) => `- ${brokerLine(n, b, snap.unverified)}`).join('\n'));
  if (!Object.values(snap.brokers).some((b) => (b.holdings || []).length || b.cash)) {
    L.push('\nNo portfolio data yet: no broker is live and nothing was carried from an earlier pull. Log in (broker_status) and run refresh.');
    return { ok: true, empty: true, totals: c.totals, cash: c.cash, alerts: [], trade_audit: t, changes: d, brokers: c.brokers, allocation: c.allocation, text: L.join('\n') };
  }
  L.push(`\nBook ${inr(c.totals.book)} (base: ${c.totals.base}) · invested ${inr(c.totals.invested)} · unrealised P&L ${inr(c.totals.pnl)}`);
  L.push(`Cash ${inr(c.cash.total)} = ${pct(c.cash.pct_of_book)} of book${c.cash.note ? `. ${c.cash.note}` : `; buffer target ${c.cash.target[0]}-${c.cash.target[1]}%`}`);
  const fx = Object.entries(snap.fx || {});
  if (fx.length) L.push(`FX: ${fx.map(([k, v]) => `${k} at ${v.rate} INR (${v.source}, ${istStamp(new Date(v.as_of))})`).join('; ')}`);
  const flags = [...t.findings.filter((f) => f.level === 'critical'), ...c.alerts.filter((a) => a.level === 'critical'), ...t.findings.filter((f) => f.level !== 'critical'), ...c.alerts.filter((a) => a.level !== 'critical')];
  L.push(`\n**Needs attention** (${flags.length})`);
  L.push(flags.length ? flags.map((f) => `- ${f.level === 'critical' ? '🔴' : '🟡'} ${f.text}`).join('\n') : '- nothing');
  if (d.baseline) {
    L.push(`\n**Changes since ${istStamp(new Date(d.baseline))}**`);
    L.push(table(['Broker', 'Symbol', 'Before', 'After', 'Cause'], d.changes.map((x) => [x.broker, x.symbol, x.before, x.after, x.cause])));
    for (const f of d.folio_drops) L.push(`- ${f.broker}: ${f.before} -> ${f.after} fund folios. ${f.note}`);
    if (d.frozen_prices.length) L.push(`- Price unchanged and equal to cost for two runs (suspended or delisted?): ${d.frozen_prices.join(', ')}`);
  }
  L.push('\n**Brokers**');
  L.push(table(['Broker', 'Value', 'P&L', 'Day', 'Cash', 'Holdings'], Object.entries(c.brokers).map(([n, b]) => [n, inr(b.value), inr(b.pnl), b.day_change === null ? 'n/a' : inr(b.day_change), b.cash === null ? 'n/a' : inr(b.cash), b.count])));
  L.push('\n**Largest positions** (% of book)');
  L.push(table(['Symbol', 'Type', 'Value', '% of book'], c.positions.slice(0, 10).map((p) => [p.symbol, p.type, inr(p.value), pct(p.pct_of_book)])));
  if (c.sectors.length > 1 || c.unclassified_sector_count) L.push(`\nSectors (% of direct equity): ${c.sectors.map((s) => `${s.sector} ${pct(s.pct_of_direct_equity)}`).join(', ')}`);
  L.push('\n**Allocation** (% of book)');
  L.push(table(['Bucket', 'Value', '% of book', 'Target', 'Drift (pp)'], c.allocation.map((a) => [a.bucket, inr(a.value), pct(a.pct_of_book), a.target_pct === null ? '-' : `${a.target_pct}%`, a.drift_pp === null ? '-' : a.drift_pp])));
  if (c.fund_houses.length) L.push(`Fund houses (% of fund book): ${c.fund_houses.map((h) => `${h.house} ${pct(h.pct_of_mf)}`).join(', ')}`);
  if (c.notes.length) L.push(`\nNotes: ${c.notes.join('; ')}`);
  L.push('\nSIP status is not available from any connected broker; ask the investor rather than infer it.');
  return { ok: true, totals: c.totals, cash: c.cash, alerts: c.alerts, trade_audit: t, changes: d, brokers: c.brokers, allocation: c.allocation, text: L.join('\n') };
}

function kiteFresh(snap, now) {
  const k = snap && snap.brokers && snap.brokers.kite;
  return k && k.status === 'live' && istDate(new Date(k.as_of)) === istDate(now);
}

async function gttAudit(args, ctx) {
  const now = ctx.now();
  const { profile } = profiles.load(args.folder);
  const snap = state.latestSnapshot(args.folder);
  if (!snap || !snap.brokers.kite) return { ok: false, error: 'no Kite data', text: 'No Kite data yet. Run refresh first.' };
  const prev = state.previousSnapshot(args.folder, istDate(new Date(snap.taken_at)));
  const a = gtt.audit(snap, prev, profile, { corporateActions: args.corporate_actions || [] });
  const stale = !kiteFresh(snap, now);
  const L = [];
  L.push(`**GTT audit** · ${istStamp(now)}${stale ? ' · ⚠️ Kite data is not from a live pull today: findings are UNVERIFIED' : ''}`);
  L.push(`${a.summary.holdings} holdings, ${a.summary.active_gtts} active GTTs · unprotected value ${inr(a.summary.unprotected_value)} · crash test ${a.summary.crash_test_pass ? 'PASS' : 'FAIL'} · book median stop distance ${a.median_stop_distance_pct ?? 'n/a'}%`);
  const sev = { critical: 0, warn: 1, info: 2 };
  const flagged = a.rows.filter((r) => r.issues.length).sort((x, y) => Math.min(...x.issues.map((i) => sev[i.severity])) - Math.min(...y.issues.map((i) => sev[i.severity])) || x.symbol.localeCompare(y.symbol));
  L.push(table(['Symbol', 'Policy', 'Qty', 'LTP', 'Stop', 'Target', 'Findings'], flagged.map((r) => [r.symbol, `${r.class}${r.implicit_verdict ? ' (default)' : ''}`, r.qty, r.ltp, r.stop ?? '-', r.target ?? '-', r.issues.map((i) => i.text).join('; ')])));
  L.push(`OK, no change: ${a.rows.length - flagged.length}`);
  L.push('\n**Crash test** (uniform move, live prices)');
  L.push(table(['Move', 'Stops that fire', 'Hold/add names firing'], a.crash.map((x) => [`${x.move_pct}%`, x.fires.length, x.hold_names_firing.join(', ') || 'none'])));
  if (a.orphans.length) L.push(`\nOrphans (no holding): ${a.orphans.map((o) => `${o.symbol} #${o.id}`).join(', ')}`);
  if (a.inactive.length) L.push(`Inactive GTTs on held names: ${a.inactive.map((g) => `${g.symbol} #${g.id} ${g.status}${g.reason ? ` (${g.reason})` : ''}`).join(', ')}`);
  if (a.vanished.length) L.push(`Active last time, missing now (cancelled by a corporate action?): ${a.vanished.map((g) => `${g.symbol} #${g.id}`).join(', ')}`);
  return { ok: true, unverified: stale, summary: a.summary, findings: flagged.length, text: L.join('\n') };
}

function planText(d, ctx, notes = []) {
  const rows = d.rows.map((r) => r.action === 'place'
    ? [r.step, 'PLACE', r.symbol, r.args.trigger_type, r.args.trigger_type === 'two-leg' ? `${r.args.lower_trigger_value} / ${r.args.upper_trigger_value}` : r.args.trigger_value, r.args.trigger_type === 'two-leg' ? r.args.lower_quantity : r.args.quantity, r.reason]
    : [r.step, 'DELETE', r.symbol, `#${r.gtt_id}`, '', '', r.reason]);
  const how = ctx.edition === 'lite'
    ? 'Enter these in Kite web (Orders > GTT): place every new GTT first, then delete the old ones, then run refresh to verify.'
    : `To execute, the investor types: approve ${d.code}  (then call execute_draft). Places run first; deletes only after the new GTTs are confirmed.`;
  return [`**GTT plan ${d.code}** · ${d.rows.length} steps`, table(['#', 'Action', 'Symbol', 'Type / id', 'Trigger(s)', 'Qty', 'Why'], rows), notes.length ? `\nNot planned: ${notes.join('; ')}` : '', `\n${how}`].join('\n');
}

async function draftGttPlan(args, ctx) {
  const { profile } = profiles.load(args.folder);
  const snap = state.latestSnapshot(args.folder);
  if (!kiteFresh(snap, ctx.now())) return { ok: false, error: 'needs a live Kite pull today', text: 'Run refresh with Kite live before drafting GTT changes.' };
  const prev = state.previousSnapshot(args.folder, istDate(new Date(snap.taken_at)));
  const a = gtt.audit(snap, prev, profile, { corporateActions: args.corporate_actions || [] });
  const p = gtt.plan(a, snap, profile, { symbols: args.symbols });
  if (!p.rows.length) return { ok: true, code: null, text: `No GTT changes needed under your policy.${p.notes.length ? ` Not planned: ${p.notes.join('; ')}` : ''}` };
  const d = drafts.create(args.folder, 'gtt_plan', p.rows);
  return { ok: true, code: d.code, rows: d.rows.length, text: planText(d, ctx, p.notes) };
}

async function pricesFor(symbols, snap, ctx) {
  const prices = {};
  for (const [, b] of Object.entries(snap ? snap.brokers : {})) for (const h of b.holdings || []) if (h.ltp && !prices[h.symbol]) prices[h.symbol] = h.ltp;
  const missing = symbols.filter((s) => !prices[s]);
  if (missing.length && kiteFresh(snap, ctx.now())) {
    try {
      const r = await ctx.brokers.kite.ltp(missing.map((s) => `NSE:${s}`));
      for (const [k, v] of Object.entries(r)) prices[k.split(':')[1]] = v;
    } catch { /* reported as missing below */ }
  }
  return prices;
}

async function draftBasket(args, ctx) {
  const { profile } = profiles.load(args.folder);
  const plan = profile.deployment_plan;
  const destinations = args.destinations || plan.destinations;
  if (!destinations || !destinations.length) return { ok: false, error: 'no destinations', text: 'No destinations given and none saved in deployment_plan.destinations.' };
  let amount = args.amount;
  let label = 'custom amount';
  if (!amount && args.stage) {
    const st = [...plan.stages].sort((a, b) => b.level - a.level)[args.stage - 1];
    if (!st || !plan.corpus_inr) return { ok: false, error: 'stage or corpus missing', text: 'Stage not found or deployment_plan.corpus_inr not set.' };
    amount = (plan.corpus_inr * st.share_pct) / 100;
    label = `stage ${args.stage} (${st.share_pct}% of ${inr(plan.corpus_inr)})`;
  }
  if (!amount) return { ok: false, error: 'amount or stage required', text: 'Give an amount or a stage number.' };
  const snap = state.latestSnapshot(args.folder);
  const prices = await pricesFor(destinations.map((d) => d.symbol.toUpperCase()), snap, ctx);
  const kite = snap && snap.brokers.kite;
  const b = basket.build({ amount, destinations, prices, cash: kite ? kite.cash : null, profile });
  const d = drafts.create(args.folder, 'basket', b.rows, { amount, label });
  const L = [`**Basket draft ${d.code}** · ${label} · ${istStamp(ctx.now())}`];
  if (b.conflicts.length) L.push(`⚠️ ${b.conflicts.join('; ')}`);
  L.push(table(['Symbol', 'Exch', 'Qty', 'LIMIT', 'Amount', 'Basis'], b.rows.map((r) => [r.symbol, r.exchange, r.qty, r.limit_price, inr(r.amount), r.basis])));
  L.push(`Total ${inr(b.total)}${b.cash_left !== null ? ` · Kite cash after ${inr(b.cash_left)}` : ''}`);
  if (b.missing_prices.length) L.push(`No live price for: ${b.missing_prices.join(', ')} (not included)`);
  L.push('\nEnter in Kite web: Orders > Baskets > New basket, add each row with type LIMIT at the price shown. Review and press Execute yourself.');
  return { ok: true, code: d.code, total: b.total, conflicts: b.conflicts, text: L.join('\n') };
}

async function crashCheck(args, ctx) {
  const now = ctx.now();
  const { profile } = profiles.load(args.folder);
  let level = args.index_level;
  let source = 'given';
  if (!level) {
    try {
      const r = await ctx.brokers.kite.ltp(['NSE:NIFTY 50']);
      level = r['NSE:NIFTY 50'];
      source = `Kite LTP ${istStamp(now)}`;
    } catch {
      return { ok: false, error: 'index level unknown', text: 'Give index_level (Kite is not live to fetch it).' };
    }
  }
  const snap = state.latestSnapshot(args.folder);
  const L = [`**Crash check** · ${profile.deployment_plan.index} at ${level} (${source})`];
  let stopRows = [];
  if (snap && snap.brokers.kite) {
    const a = gtt.audit(snap, null, profile);
    stopRows = crash.stopReview(a.rows, profile.gtt_policy);
    L.push(table(['Move', 'Stops that fire', 'Hold/add names firing'], a.crash.map((x) => [`${x.move_pct}%`, x.fires.length, x.hold_names_firing.join(', ') || 'none'])));
    L.push(stopRows.length ? `Stops that would force-sell names you intend to keep:\n${stopRows.map((s) => `- ${s.symbol}: stop ${s.stop} (${s.distance_pct}% below); ${s.proposal}`).join('\n')}` : 'No hold/add stop is tighter than your policy minimum.');
  }
  const plan = profile.deployment_plan;
  if (!plan.stages.length) {
    L.push('\nNo staged deployment plan saved. Nothing is drafted; write the plan first (levels, share of corpus, destinations).');
    return { ok: true, stage: null, text: L.join('\n') };
  }
  const s = crash.stageReached(plan, level);
  L.push('\n' + table(['Stage', 'Level', 'Share', 'Reached'], s.stages.map((x) => [x.number, x.level, `${x.share_pct}%`, x.reached ? 'yes' : 'no'])));
  let draft = null;
  if (s.reached && plan.corpus_inr && plan.destinations.length) {
    draft = await draftBasket({ folder: args.folder, stage: s.reached.number }, ctx);
    L.push(`\n${draft.text}`);
  } else if (s.reached) L.push('\nStage reached, but corpus_inr or destinations are not saved, so no basket is drafted.');
  L.push('\nClassify the fall (structural vs sentiment) with sources before acting. Never tighten stops in a fall.');
  return { ok: true, stage: s.reached ? s.reached.number : null, draft: draft && draft.code, text: L.join('\n') };
}

async function rateMap(args) {
  const { profile } = profiles.load(args.folder);
  const snap = state.latestSnapshot(args.folder);
  if (!snap) return { ok: false, error: 'no snapshot', text: 'Run refresh first.' };
  const groups = { most: [], mixed: [], least: [], unknown: [] };
  const seen = new Set();
  for (const h of snapshotLib.allHoldings(snap)) {
    if (h.type === 'mf' || seen.has(h.symbol)) continue;
    seen.add(h.symbol);
    const c = rates.classify(h.symbol, h.type, profile);
    groups[c.bucket].push({ symbol: h.symbol, value: h.value_inr, basis: c.basis });
  }
  const line = (k) => groups[k].sort((a, b) => b.value - a.value).map((x) => `${x.symbol} (${x.basis})`).join(', ') || 'none';
  const total = (k) => inr(groups[k].reduce((a, x) => a + (x.value || 0), 0));
  return {
    ok: true, groups,
    text: [`**Rate sensitivity** (default map; your rate_overrides win) · ${istStamp(new Date(snap.taken_at))}`,
      `- Most exposed ${total('most')}: ${line('most')}`, `- Mixed ${total('mixed')}: ${line('mixed')}`, `- Least exposed ${total('least')}: ${line('least')}`,
      groups.unknown.length ? `- Unclassified: ${line('unknown')}. Add sectors with profile_update sectors.<SYMBOL>.` : '',
      'Re-check the most exposed names before each RBI policy meeting.'].filter(Boolean).join('\n'),
  };
}

async function profileGet(args) {
  const { profile, exists, errors } = profiles.load(args.folder);
  const value = profiles.getPath(profile, args.path);
  return { ok: true, exists, errors, value, text: `${exists ? '' : '(no profile saved yet: showing defaults)\n'}${errors.length ? `Problems: ${errors.join('; ')}\n` : ''}\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\`` };
}

async function profileUpdate(args) {
  if (!args.path) return { ok: false, error: 'path required', text: 'path required' };
  const r = profiles.update(args.folder, args.path, args.value);
  return r.ok ? { ok: true, value: r.value, text: `Saved ${args.path}.` } : { ok: false, errors: r.errors, text: `Not saved: ${r.errors.join('; ')}` };
}

async function logAppend(args, ctx) {
  const r = log.append(args.folder, { text: args.text, startHere: args.start_here }, ctx.now());
  return { ok: true, ...r, text: `Logged to ${r.path}${r.archived.length ? ` (archived ${r.archived.join(', ')})` : ''}.` };
}

async function executeDraft(args, ctx) {
  const v = drafts.verify(args.folder, String(args.code || '').toUpperCase(), ctx.now());
  if (!v.ok) return { ok: false, error: v.reason, text: `Not executed: ${v.reason}. The investor must type "approve <code>" after reading the draft.` };
  const d = v.draft;
  if (d.kind !== 'gtt_plan') return { ok: false, error: 'only GTT plans execute here', text: 'Baskets are entered and executed by you in Kite web; there is no basket API.' };
  const results = [];
  const places = d.rows.filter((r) => r.action === 'place');
  const deletes = d.rows.filter((r) => r.action === 'delete');
  for (const r of places) {
    try {
      const res = await ctx.brokers.kite.placeGtt(r.args);
      results.push({ step: r.step, ok: true, detail: typeof res === 'object' ? res : String(res).slice(0, 120) });
    } catch (e) {
      results.push({ step: r.step, ok: false, detail: e.message.slice(0, 160) });
    }
  }
  const placeFailed = results.some((x) => !x.ok);
  if (!placeFailed) {
    for (const r of deletes) {
      try {
        await ctx.brokers.kite.deleteGtt(r.gtt_id);
        results.push({ step: r.step, ok: true, detail: 'deleted' });
      } catch (e) {
        results.push({ step: r.step, ok: false, manual: true, detail: `delete failed (${e.message.slice(0, 80)}): delete #${r.gtt_id} in Kite web` });
      }
    }
  }
  d.status = 'executed';
  d.executed_at = ctx.now().toISOString();
  d.results = results;
  drafts.save(args.folder, d);
  const manual = results.filter((x) => x.manual).map((x) => d.rows[x.step - 1].gtt_id);
  return {
    ok: !placeFailed, results,
    text: [`**Executed ${d.code}**`, table(['#', 'Result', 'Detail'], results.map((x) => [x.step, x.ok ? 'ok' : 'FAILED', typeof x.detail === 'string' ? x.detail : JSON.stringify(x.detail).slice(0, 100)])),
      placeFailed ? 'A placement failed, so no old GTT was deleted. Nothing is left unprotected.' : '',
      manual.length ? `Delete manually in Kite web (Orders > GTT): ${manual.map((id) => `#${id}`).join(', ')}` : '',
      'Run refresh, then gtt_audit, to verify the final state.'].filter(Boolean).join('\n'),
  };
}

// ---------------------------------------------------------------------------------------

const TOOLS = [
  { name: 'broker_status', handler: brokerStatus, description: 'Check every enabled broker independently: live, needs_login (with a login link returned by that broker), outage, or disabled. Call first in every session.', props: {} },
  { name: 'broker_login', handler: brokerLogin, description: 'Start a broker login (kite: returns link; kotak: start returns link + QR steps, validate confirms after the investor scans).', props: { broker: { type: 'string', enum: ['kite', 'kotak'] }, step: { type: 'string', enum: ['start', 'validate'] }, ucc: { type: 'string' } }, required: ['broker'] },
  { name: 'refresh', handler: refresh, description: "Pull all live brokers, save today's snapshot, and return the consolidated portfolio check (totals, cash, alerts, trade audit, changes since last snapshot).", props: { brokers: { type: 'array', items: { type: 'string' } } } },
  { name: 'ingest', handler: ingest, description: "Add holdings from a broker core does not connect to (IBKR connector output, or a holdings CSV statement) to today's snapshot. Foreign currency needs fx_rate and fx_source.", props: { broker: { type: 'string' }, holdings: { type: 'array', items: { type: 'object' } }, csv_path: { type: 'string' }, cash: { type: 'number' }, currency: { type: 'string' }, fx_rate: { type: 'number' }, fx_source: { type: 'string' }, source: { type: 'string' } }, required: ['broker'] },
  { name: 'check', handler: check, description: 'Re-render the consolidated portfolio check from the latest snapshot without pulling brokers.', props: {} },
  { name: 'gtt_audit', handler: gttAudit, description: "Audit Kite GTTs against the investor's policy: per-symbol quantity gaps, policy violations, crash test, outliers, orphans, cancelled GTTs, corporate-action re-scoring.", props: { corporate_actions: { type: 'array', items: { type: 'object', properties: { symbol: { type: 'string' }, kind: { type: 'string', enum: ['bonus', 'split', 'demerger', 'dividend'] }, ratio: { type: 'string' }, price_factor: { type: 'number' }, ex_date: { type: 'string' }, confirmed: { type: 'boolean' } } } } } },
  { name: 'draft_gtt_plan', handler: draftGttPlan, description: 'Draft GTT changes that bring the book in line with policy. New GTTs are placed before old ones are deleted. Returns a draft code.', props: { symbols: { type: 'array', items: { type: 'string' } }, corporate_actions: { type: 'array', items: { type: 'object' } } } },
  { name: 'draft_basket', handler: draftBasket, description: 'Draft basket rows (symbol, qty, LIMIT price) for an amount or a saved deployment stage, for manual entry in Kite web.', props: { amount: { type: 'number' }, stage: { type: 'number' }, destinations: { type: 'array', items: { type: 'object' } } } },
  { name: 'crash_check', handler: crashCheck, description: "Crash mode: stops that would fire, stops that would force-sell hold names, and which stage of the investor's saved deployment plan the index has reached (drafts that stage's basket).", props: { index_level: { type: 'number' } } },
  { name: 'rate_map', handler: rateMap, description: 'Group holdings by interest-rate sensitivity (default map plus profile overrides).', props: {} },
  { name: 'profile_get', handler: profileGet, description: "Read the investor's profile (or a dotted path in it).", props: { path: { type: 'string' } } },
  { name: 'profile_update', handler: profileUpdate, description: 'Set one dotted path in the profile (e.g. cash.buffer_location = "bank", verdicts.SBIN = {stance, reason}). Validated before saving. Only on the investor\'s instruction.', props: { path: { type: 'string' }, value: {} }, required: ['path'] },
  { name: 'log_append', handler: logAppend, description: 'Append a dated entry to the log and optionally rewrite the "Start here" block. Older months archive automatically.', props: { text: { type: 'string' }, start_here: { type: 'string' } } },
  { name: 'execute_draft', handler: executeDraft, fullOnly: true, description: 'Execute an approved GTT plan. Refuses unless the investor typed "approve <code>" for this exact draft. Places first, deletes after.', props: { code: { type: 'string' } }, required: ['code'] },
];

function listTools(edition) {
  return TOOLS.filter((t) => !(t.fullOnly && edition === 'lite')).map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: { type: 'object', properties: { ...FOLDER, ...t.props }, required: t.required || [] },
  }));
}

function makeContext(overrides = {}) {
  return { edition: process.env.PORTFOLIO_EDITION || 'full', brokers: defaultBrokers(), now: () => new Date(), ...overrides };
}

async function callTool(name, args, ctx) {
  const t = TOOLS.find((x) => x.name === name && !(x.fullOnly && ctx.edition === 'lite'));
  if (!t) return { ok: false, error: `unknown tool ${name}`, text: `Unknown tool ${name}` };
  try {
    return await t.handler(args || {}, ctx);
  } catch (e) {
    return { ok: false, error: e.message, text: `Error in ${name}: ${e.message}` };
  }
}

module.exports = { TOOLS, listTools, callTool, makeContext };
