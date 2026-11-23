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
const protection = require('./lib/protection');
const gapLib = require('./lib/gap');
const version = require('./lib/version');
const inputs = require('./lib/inputs');
const toolmap = require('./lib/brokers/toolmap');
const connectLib = require('./lib/connect');
const bundle = require('./lib/bundle');
const review = require('./lib/review');
const decisionsLib = require('./lib/decisions');
const journalLib = require('./lib/journal');
const concentration = require('./lib/rules/concentration');
const marksLib = require('./lib/marks');
const profitLock = require('./lib/rules/profit_lock');
const exportLib = require('./lib/export');
const lotsLib = require('./lib/lots');
const technicals = require('./lib/technicals');
const setupsLib = require('./lib/setups');
const deployLib = require('./lib/deploy');
const intraday = require('./lib/intraday');
const lossTolerance = require('./lib/rules/loss_tolerance');
const path = require('path');
const session = require('./lib/session');
const { istStamp, istDate, inr, pct, table } = require('./lib/format');

const FOLDER = { folder: { type: 'string', description: "The investor's working folder (absolute path). Pass it on the first call; it is remembered." } };

// ---------------------------------------------------------------------------------------

// Connect first, then work (US2): the next broker calls, every manual step at once, `ready`.
async function connect(args, ctx) {
  const { profile } = profiles.load(args.folder);
  const tools = Array.isArray(args.tools) ? args.tools.map(String) : [];
  if (!tools.length) return { ok: false, error: 'tools required', text: 'Pass tools: every broker MCP tool name you can see in this chat (full names).' };
  const skip = Array.isArray(args.skip) ? args.skip.map((s) => String(s).toLowerCase()) : [];
  const r = connectLib.connect({ tools, skip, unattended: !!args.unattended, fromCaptures: !!args.from_captures }, profile, ctx.now());
  const warn = version.mismatch({ plugin: args.hook_plugin, version: args.hook_version });
  return { ...r, text: [`**Connect** · ${istStamp(ctx.now())}`, ...(warn ? [warn] : []), r.text].join('\n') };
}

// Alias of connect, with the broker tools seen in this chat's captures.
async function brokerStatus(args, ctx) {
  const caps = [...session.CAPTURED, 'session'];
  const seen = ['kite', 'kotak', 'ibkr'].flatMap((b) => caps.map((c) => session.read(b, c)).filter(Boolean).map((r) => r.tool));
  const r = await connect({ ...args, tools: seen.length ? [...new Set(seen)] : ['none'], from_captures: true }, ctx);
  return { ok: true, brokers: r.brokers, ready: r.ready, next: r.next, manual: r.manual, text: r.text };
}

function todaySnapshot(folder, now) {
  const today = state.loadSnapshot(folder, istDate(now));
  if (today) return today;
  const snap = { taken_at: now.toISOString(), brokers: {}, fx: {}, unverified: {} };
  // A new day starts from the last snapshot with every broker marked "not pulled", so an
  // ingest or a partial refresh never makes the rest of the book disappear (issue #4).
  const prev = state.previousSnapshot(folder, istDate(now));
  if (prev) {
    for (const [name, b] of Object.entries(prev.brokers || {})) {
      snap.brokers[name] = { ...b, status: 'not_pulled', carried_from: b.carried_from || b.as_of };
    }
    snap.fx = { ...(prev.fx || {}) };
    snap.unverified = { ...(prev.unverified || {}) };
  }
  return snap;
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
    const r = inputs.pull(name, profile, now);
    const s = { status: r.status, detail: r.detail };
    const key = `${name}:verification`;
    if (r.block) {
      snap.brokers[name] = r.block;
      snap.unverified[key] = 0;
      pulled.push(name);
    } else {
      const carried = (snap.brokers[name] && snap.brokers[name].status === 'live' ? snap.brokers[name] : prev && prev.brokers[name]) || null;
      snap.brokers[name] = carried ? { ...carried, status: s.status, carried_from: carried.as_of } : { status: s.status, holdings: [], gtts: [], orders: [], cash: null };
      snap.brokers[name].detail = s.detail || null;
      snap.unverified[key] = ((prev && prev.unverified && prev.unverified[key]) || 0) + 1;
    }
  }
  snapshotLib.valuate(snap, prev, profile);
  // Daily closes the engine keeps itself: averages and RSI appear once there are enough (FR-052).
  snap.technicals = technicals.update(args.folder, snap, date);
  state.saveSnapshot(args.folder, date, snap);
  // Profit-lock marks follow each pull: highest close, lock stage, re-entry list.
  if (snap.brokers.kite && snap.brokers.kite.status === 'live') marksLib.save(args.folder, marksLib.update(marksLib.load(args.folder), snap, profile, profitLock.stopsOf(snap, profile), now));
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
    const rows = args.holdings || [];
    // IBKR's positions read names the instrument contract_description, not symbol.
    const symOf = (h) => String(h.symbol ?? h.contract_description ?? h.ticker ?? h.tradingsymbol ?? '').trim();
    const bad = rows.map((h, i) => (symOf(h) ? null : i)).filter((i) => i !== null);
    if (bad.length) return { ok: false, error: `no symbol on holding row(s) ${bad.join(', ')}`, text: `Nothing ingested: ${bad.length} row(s) have no symbol (looked for symbol, contract_description, ticker, tradingsymbol). Row index: ${bad.join(', ')}.` };
    holdings = rows.map((h) => {
      const qty = norm.num(h.qty ?? h.quantity ?? h.position) || 0;
      const ltp = norm.num(h.ltp ?? h.last_price ?? h.market_price);
      const value = norm.num(h.value ?? h.market_value) ?? (ltp !== null ? qty * ltp : null);
      const avg = norm.num(h.avg ?? h.average_price ?? h.avg_cost);
      return { broker, symbol: symOf(h).toUpperCase(), exchange: h.exchange || null, type: h.type || (args.currency && args.currency !== 'INR' ? 'foreign' : 'equity'), qty, avg, ltp, value, pnl: norm.num(h.pnl ?? h.unrealized_pnl) ?? (value !== null && avg !== null ? value - qty * avg : null), day_change: norm.num(h.day_change ?? h.daily_pnl), currency: h.currency || args.currency || 'INR' };
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
  const t = tradeAudit(snap, c, d, profile, [...(profile.reentry || []).map((r) => ({ cooloff_days: profile.gtt_policy.profit_lock.reentry_cooloff_days, ...r })), ...marksLib.load(args.folder).reentry]);
  // Cash that drops to exactly 0 between snapshots is worth a look: a withdrawal, or bad data (issue #5).
  for (const [name, b] of Object.entries(snap.brokers)) {
    const was = prev && prev.brokers && prev.brokers[name];
    if (b.status === 'live' && b.cash === 0 && was && was.cash > 0) {
      c.alerts.push({ level: 'warn', text: `${name} cash is ${inr(0)} as reported by ${name}, was ${inr(was.cash)} at ${istStamp(new Date(was.as_of))}: confirm in ${name} (withdrawal, or bad data?)` });
    }
  }
  if (c.unclassified_sector_count && !Object.keys(profile.sectors || {}).length) c.notes.push('sector limit not checked: the profile has no sector map (profile.sectors)');
  // Hold stops drift inside the floor as prices fall; say so without waiting for a GTT audit (issue #7).
  if (snap.brokers.kite && (snap.brokers.kite.gtts || []).length) {
    const worst = gtt.audit(snap, prev, profile).crash.slice(-1)[0];
    if (worst && worst.hold_names_firing.length) {
      c.alerts.push({ level: 'warn', text: `${worst.hold_names_firing.length} hold stop(s) would fire in a ${worst.move_pct}% fall (${worst.hold_names_firing.join(', ')}): analyze each before changing (strong company, macro fall: widen; company weakening: keep)` });
    }
  }
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
  L.push(guardrails(snap, c, profile, prev));
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
  L.push(table(['Symbol', 'Type', 'Value', '% of book'], c.positions.slice(0, 10).map((p) => [p.name || p.symbol, p.type, inr(p.value), pct(p.pct_of_book)])));
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

function crashRow(x) {
  const kept = x.kept_names_firing.length ? ` (kept by decision: ${x.kept_names_firing.join(', ')})` : '';
  return [`${x.move_pct}%`, x.fires.length, `${x.hold_names_firing.join(', ') || 'none'}${kept}`, (x.locked_names_firing || []).join(', ') || 'none'];
}

async function gttAudit(args, ctx) {
  const now = ctx.now();
  const { profile } = profiles.load(args.folder);
  const snap = state.latestSnapshot(args.folder);
  if (!snap || !snap.brokers.kite) return { ok: false, error: 'no Kite data', text: 'No Kite data yet. Run refresh first.' };
  const prev = state.previousSnapshot(args.folder, istDate(new Date(snap.taken_at)));
  const a = gtt.audit(snap, prev, profile, { corporateActions: args.corporate_actions || [], today: istDate(ctx.now()), marks: marksLib.load(args.folder) });
  const stale = !kiteFresh(snap, now);
  const L = [];
  L.push(`**GTT audit** · ${istStamp(now)}${stale ? ' · ⚠️ Kite data is not from a live pull today: findings are UNVERIFIED' : ''}`);
  L.push(`${a.summary.holdings} holdings, ${a.summary.active_gtts} active GTTs · unprotected value ${inr(a.summary.unprotected_value)} · crash test ${a.summary.crash_test_pass ? 'PASS' : 'FAIL'} · book median stop distance ${a.median_stop_distance_pct ?? 'n/a'}%`);
  const sev = { critical: 0, warn: 1, info: 2 };
  const flagged = a.rows.filter((r) => r.issues.length).sort((x, y) => Math.min(...x.issues.map((i) => sev[i.severity])) - Math.min(...y.issues.map((i) => sev[i.severity])) || x.symbol.localeCompare(y.symbol));
  L.push(table(['Symbol', 'Policy', 'Qty', 'LTP', 'Stop', 'Target', 'Findings'], flagged.map((r) => [r.symbol, `${r.class}${r.implicit_verdict ? ' (default)' : ''}`, r.qty, r.ltp, r.stop ?? '-', r.target ?? '-', r.issues.map((i) => i.text).join('; ')])));
  L.push(`OK, no change: ${a.rows.length - flagged.length}`);
  L.push('\n**Crash test** (uniform move, live prices)');
  L.push(table(['Move', 'Stops that fire', 'Hold/add names firing', 'Profit-locked names firing'], a.crash.map(crashRow)));
  if (a.orphans.length) L.push(`\nOrphans (no holding): ${a.orphans.map((o) => `${o.symbol} #${o.id}`).join(', ')}`);
  if (a.inactive.length) L.push(`Inactive GTTs on held names: ${a.inactive.map((g) => `${g.symbol} #${g.id} ${g.status}${g.reason ? ` (${g.reason})` : ''}`).join(', ')}`);
  if (a.vanished.length) L.push(`Active last time, missing now (cancelled by a corporate action?): ${a.vanished.map((g) => `${g.symbol} #${g.id}`).join(', ')}`);
  return { ok: true, unverified: stale, summary: a.summary, findings: flagged.length, text: L.join('\n') };
}

function callsBlock(d) {
  return ['Calls to make after Yes, in this order, with exactly these arguments (the order gate allows each once):']
    .concat(d.rows.map((r) => `${r.step}. ${r.tool} ${JSON.stringify(r.args)}`)).join('\n');
}

function planText(d, ctx, notes = []) {
  const rows = d.rows.map((r) => r.action === 'place'
    ? [r.step, 'PLACE', r.symbol, r.args.trigger_type, r.args.trigger_type === 'two-leg' ? `${r.args.lower_trigger_value} / ${r.args.upper_trigger_value}` : r.args.trigger_value, r.args.trigger_type === 'two-leg' ? r.args.lower_quantity : r.args.quantity, r.reason]
    : [r.step, 'DELETE', r.symbol, `#${r.gtt_id}`, '', '', r.reason]);
  const how = ctx.edition === 'lite'
    ? 'Enter these in Kite web (Orders > GTT): place every new GTT first, then delete the old ones, then read GTTs again and run refresh to verify.'
    : `To execute: ask the investor with AskUserQuestion. Header "${d.code}"; question naming ${d.code} with one line per row above; options in this order: "No, don't place", then "Yes, place ${d.code}". Never pre-fill answers. After Yes, call the Kite MCP tools below, places first and deletes only after every place succeeded. If a delete fails in the MCP, delete only those ids in Kite web (Orders > GTT, ticking exactly the planned ids). Then read GTTs again and run refresh and gtt_audit to verify. If the broker answers that a call needs its own approval, show its approval link or step to the investor and wait; never approve it yourself.\n\n${callsBlock(d)}`;
  return [`**GTT plan ${d.code}** · ${d.rows.length} steps`, table(['#', 'Action', 'Symbol', 'Type / id', 'Trigger(s)', 'Qty', 'Why'], rows), notes.length ? `\nNot planned: ${notes.join('; ')}` : '', `\n${how}`].join('\n');
}

async function draftGttPlan(args, ctx) {
  const { profile } = profiles.load(args.folder);
  const snap = state.latestSnapshot(args.folder);
  if (!kiteFresh(snap, ctx.now())) return { ok: false, error: 'needs a live Kite pull today', text: 'Run refresh with Kite live before drafting GTT changes.' };
  const prev = state.previousSnapshot(args.folder, istDate(new Date(snap.taken_at)));
  const marks = marksLib.load(args.folder);
  const a = gtt.audit(snap, prev, profile, { corporateActions: args.corporate_actions || [], today: istDate(ctx.now()), marks });
  const p = gtt.plan(a, snap, profile, { symbols: args.symbols, lockStops: profitLock.targets(snap, profile, marks, Object.fromEntries(a.rows.map((r) => [r.symbol, r.stop]))) });
  if (!p.rows.length) return { ok: true, code: null, text: `No GTT changes needed under your policy.${p.notes.length ? ` Not planned: ${p.notes.join('; ')}` : ''}` };
  const gen = inputs.genOf('kite');
  const rows = p.rows.map((r) => ({ ...r, cap: 'gtt_write', ...(r.action === 'place' ? toolmap.writeCall('kite', 'gtt_write', 'place', r.args, gen) : toolmap.writeCall('kite', 'gtt_write', 'delete', { trigger_id: Number(r.gtt_id) }, gen)) }));
  const d = drafts.create(args.folder, 'gtt_plan', rows);
  return { ok: true, code: d.code, rows: d.rows.length, text: planText(d, ctx, p.notes) };
}

function pricesFor(symbols, snap) {
  const prices = {};
  for (const [, b] of Object.entries(snap ? snap.brokers : {})) for (const h of b.holdings || []) if (h.ltp && !prices[h.symbol]) prices[h.symbol] = h.ltp;
  const captured = inputs.ltp();
  for (const s of symbols) if (!prices[s] && captured[`NSE:${s}`]) prices[s] = captured[`NSE:${s}`];
  return prices;
}

// War-chest corpus: read live from the holding named by corpus_source, else the saved figure (issue #6).
function corpusOf(plan, snap) {
  if (plan.corpus_source && snap) {
    const needle = String(plan.corpus_source).toUpperCase();
    const hits = Object.values(snap.brokers || {}).flatMap((b) => (b.holdings || []).filter((h) => `${h.symbol} ${h.name || ''}`.toUpperCase().includes(needle)));
    if (hits.length) {
      const total = hits.reduce((a, h) => a + (h.value || 0), 0);
      return { inr: total, basis: `${hits.map((h) => h.name || h.symbol).join(' + ')}, snapshot ${istStamp(new Date(snap.taken_at))}` };
    }
  }
  return plan.corpus_inr ? { inr: plan.corpus_inr, basis: 'saved corpus_inr' } : null;
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
    const corpus = corpusOf(plan, state.latestSnapshot(args.folder));
    if (!st || !corpus) return { ok: false, error: 'stage or corpus missing', text: `${!st ? `Stage ${args.stage} not found. ` : ''}${!corpus ? 'No corpus: set deployment_plan.corpus_source (a holding name such as "ARBITRAGE") or deployment_plan.corpus_inr.' : ''}`.trim() };
    amount = (corpus.inr * st.share_pct) / 100;
    label = `stage ${args.stage} (${st.share_pct}% of ${inr(corpus.inr)}, ${corpus.basis})`;
  }
  if (!amount) return { ok: false, error: 'amount or stage required', text: 'Give an amount or a stage number.' };
  const snap = state.latestSnapshot(args.folder);
  const prices = pricesFor(destinations.map((d) => d.symbol.toUpperCase()), snap);
  const kite = snap && snap.brokers.kite;
  const b = basket.build({ amount, destinations, prices, cash: kite ? kite.cash : null, profile });
  const gen = inputs.genOf('kite');
  const orders = b.rows.map((r) => ({ ...r, cap: 'order_write', ...toolmap.writeCall('kite', 'order_write', 'place', { variety: 'regular', exchange: r.exchange, tradingsymbol: r.symbol, transaction_type: 'BUY', quantity: r.qty, product: 'CNC', order_type: 'LIMIT', price: r.limit_price }, gen) }));
  const d = drafts.create(args.folder, 'basket', orders, { amount, label });
  const L = [`**Basket draft ${d.code}** · ${label} · ${istStamp(ctx.now())}`];
  if (b.conflicts.length) L.push(`⚠️ ${b.conflicts.join('; ')}`);
  L.push(table(['Symbol', 'Exch', 'Qty', 'LIMIT', 'Amount', 'Basis'], b.rows.map((r) => [r.symbol, r.exchange, r.qty, r.limit_price, inr(r.amount), r.basis])));
  L.push(`Total ${inr(b.total)}${b.cash_left !== null ? ` · Kite cash after ${inr(b.cash_left)}` : ''}`);
  if (args.format === 'kite_json') {
    const f = path.join(state.stateDir(args.folder), 'baskets', `basket-${d.code}.json`);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, JSON.stringify(basket.kiteJson(b.rows), null, 2));
    L.push(`Kite import file: ${f} (format unverified: if Kite rejects it, say so and send one exported basket so the format can be fixed). Import in Kite web: Orders > Baskets > New basket > import the file, review each row, then Execute yourself.`);
  }
  if (b.missing_prices.length) L.push(`No live price for: ${b.missing_prices.join(', ')} (not included). Call the Kite MCP ${toolmap.show(toolmap.ltpCall('kite', gen, b.missing_prices.map((x) => `NSE:${x}`)))} and draft again.`);
  L.push(ctx.edition === 'lite'
    ? '\nEnter in Kite web: Orders > Baskets > New basket, add each row with type LIMIT at the price shown. Review and press Execute yourself.'
    : `\nTo execute: ask the investor with AskUserQuestion. Header "${d.code}"; question naming ${d.code} with one line per row above; options in this order: "No, don't place", then "Yes, place ${d.code}". Never pre-fill answers. After Yes, make the Kite MCP calls below, once per row, with exactly these arguments (the order gate allows each once). If the broker answers that the order needs its own approval, show its approval link or step to the investor and wait; never approve it yourself. Then read orders again to confirm, and run gtt_audit: new shares need a GTT.\n\n${callsBlock(d)}`);
  return { ok: true, code: d.code, total: b.total, conflicts: b.conflicts, text: L.join('\n') };
}

async function crashCheck(args, ctx) {
  const now = ctx.now();
  const { profile } = profiles.load(args.folder);
  let level = args.index_level;
  let source = 'given';
  if (!level) {
    level = inputs.ltp()['NSE:NIFTY 50'];
    source = 'Kite price read, captured in this chat';
    if (!level) return { ok: false, error: 'index level unknown', text: `Give index_level, or call the Kite MCP ${toolmap.show(toolmap.ltpCall('kite', inputs.genOf('kite'), ['NSE:NIFTY 50']))} first.` };
  }
  const snap = state.latestSnapshot(args.folder);
  const L = [`**Crash check** · ${profile.deployment_plan.index} at ${level} (${source})`];
  let stopRows = [];
  if (snap && snap.brokers.kite) {
    const a = gtt.audit(snap, null, profile, { today: istDate(ctx.now()) });
    stopRows = crash.stopReview(a.rows, profile.gtt_policy);
    L.push(table(['Move', 'Stops that fire', 'Hold/add names firing', 'Profit-locked names firing'], a.crash.map(crashRow)));
    L.push(stopRows.length ? `Stops that would force-sell names you intend to keep:\n${stopRows.map((s) => `- ${s.symbol}: stop ${s.stop} (${s.distance_pct}% below); ${s.proposal}`).join('\n')}` : 'No hold/add stop is tighter than your policy minimum.');
  }
  const plan = profile.deployment_plan;
  if (!plan.stages.length) {
    L.push('\nNo staged deployment plan saved. Nothing is drafted; write the plan first (levels, share of corpus, destinations).');
    return { ok: true, stage: null, text: L.join('\n') };
  }
  const s = crash.stageReached(plan, level);
  L.push('\n' + table(['Stage', 'Level', 'Share', 'Reached'], s.stages.map((x) => [x.number, x.level, `${x.share_pct}%`, x.done ? `done ${x.done_at}` : x.reached ? 'yes' : 'no'])));
  let draft = null;
  const corpus = corpusOf(plan, snap);
  const missing = [!corpus && 'deployment_plan.corpus_source (or corpus_inr)', !plan.destinations.length && 'deployment_plan.destinations'].filter(Boolean);
  const next = s.pending[0];
  if (next && !missing.length) {
    draft = await draftBasket({ folder: args.folder, stage: next.number }, ctx);
    L.push(`\n${draft.text}`);
    if (s.pending.length > 1) L.push(`Also reached and not done: stage ${s.pending.slice(1).map((x) => x.number).join(', ')}.`);
  } else if (next) L.push(`\nStage ${next.number} reached, but ${missing.join(' and ')} ${missing.length > 1 ? 'are' : 'is'} not saved, so no basket is drafted. Set with profile_update.`);
  else if (s.reached) L.push('\nEvery reached stage is already marked done; nothing to draft.');
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
    const c = rates.classify(h.symbol, h.type, profile, h.currency);
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

async function protectionCheck(args) {
  const { profile } = profiles.load(args.folder);
  const r = protection.check(profile);
  const pr = profile.protection;
  const L = ['**Protection and buffer** (from your saved inputs; none of this is read from a broker)'];
  L.push(`- Emergency fund ${inr(pr.emergency_fund_inr)} · monthly expenses ${inr(pr.monthly_expenses_inr)} · ${r.months === null ? 'months covered n/a' : `${r.months.toFixed(1)} months covered`}`);
  L.push(`- Term cover ${inr(pr.term_cover_inr)} · health cover: ${pr.health_cover}`);
  for (const f of r.findings) L.push(`${f.level === 'warn' ? '⚠️' : '-'} ${f.text}`);
  const sips = profile.sips;
  L.push(sips.length ? `\n**SIPs** (as confirmed by you)\n${table(['Fund', 'Amount', 'Action'], sips.map((s) => [s.fund, inr(s.amount_inr), s.action === 'redirect' ? `redirect to ${s.redirect_to}` : s.action || 'continue']))}` : '\nNo SIPs recorded. Coin SIPs are not readable from any broker: ask the investor, then save `sips` with profile_update.');
  return { ok: true, months_of_expenses: r.months, findings: r.findings, text: L.join('\n') };
}

async function verdictNotes(args) {
  const { profile } = profiles.load(args.folder);
  const rows = Object.entries(profile.verdicts).sort(([a], [b]) => a.localeCompare(b));
  if (!rows.length) return { ok: true, text: 'No verdicts saved.' };
  const line = ([sym, v]) => {
    const bits = [`${sym}: ${v.stance.toUpperCase()}${v.reason ? `, ${v.reason}` : ''}`];
    if (v.exit_level) bits.push(`exit at ${v.exit_level}`);
    if (v.stop_review) bits.push(`stop ${v.stop_review.decision === 'keep' ? 'kept' : 'to widen'} (${v.stop_review.at || 'undated'}${v.stop_review.reason ? `, ${v.stop_review.reason}` : ''}${v.stop_review.review_by ? `, review by ${v.stop_review.review_by}` : ''})`);
    return `- ${bits.join('; ')}`;
  };
  return { ok: true, text: `**Verdicts** (the profile is the source; paste into your notes file to keep it in step)\n${rows.map(line).join('\n')}` };
}

// Gaps the hooks queued (they have no network): file each one now, then clear the queue.
async function flushGaps(args, ctx) {
  const queued = gapLib.takePending();
  if (!queued.length) return { ok: true, flushed: 0, text: 'No queued gaps.' };
  const out = [];
  for (const g of queued) out.push((await reportGap({ ...g, folder: args.folder, flush: false }, ctx)).text);
  return { ok: true, flushed: queued.length, text: `Filed ${queued.length} queued gap(s):\n${out.map((t) => `- ${t}`).join('\n')}` };
}

// What each enabled broker's MCP offers right now, from the tool names the model can see.
async function doctor(args, ctx) {
  const { profile } = profiles.load(args.folder);
  const tools = Array.isArray(args.tools) ? args.tools.map(String) : [];
  if (!tools.length) return { ok: false, error: 'tools required', text: 'Pass tools: every broker MCP tool name you can see in this chat (full names, for example the Kite and Kotak Neo tools).' };
  const d = toolmap.doctor(tools, profile);
  const yes = (v) => (v === null ? 'n/a' : v ? 'yes' : 'NO');
  const rows = d.map((b) => [b.broker, b.generation, yes(b.read_path), yes(b.write_path), b.missing.join(', ') || '-', b.unknown.map((n) => n.split('__').pop()).join(', ') || '-']);
  const L = [`**Broker tools** · ${istStamp(ctx.now())}`, table(['Broker', 'Tools gen', 'Can read', 'Can write', 'Missing', 'Unknown to the plugin'], rows)];
  for (const b of d) L.push(`${b.mcp} reads: ${b.calls.filter((c) => c.required).map((c) => c.text).join(' · ')}${b.calls.some((c) => !c.required) ? ` (optional: ${b.calls.filter((c) => !c.required).map((c) => c.text).join(' · ')})` : ''}`);
  if (d.some((b) => b.unknown.length)) L.push('Unknown tools on Kite or IBKR are blocked by the order gate until the plugin knows them; report_gap with the names.');
  // A broker MCP added under a name the plugin does not recognise is outside the order gate.
  const stray = tools.filter((n) => !toolmap.resolve(n, {}).broker && /^mcp__/.test(n) && /(order|gtt|trade|basket)/i.test(n.split('__').pop()));
  if (stray.length) L.push(`Warning: ${stray.slice(0, 5).join(', ')} look like broker order tools on a server the plugin does not recognise, so the order gate does not cover them. Rename that connector to include the broker's name (kite, kotak, ibkr), or remove it.`);
  if (d.some((b) => b.read_path === false)) L.push('A broker that cannot read is not connected in this chat, or its tools changed: reconnect it, or report_gap with this table.');
  return { ok: true, brokers: d, text: L.join('\n') };
}

async function reportGap(args, ctx) {
  if (args.flush) return flushGaps(args, ctx);
  if (!args.title || !args.missing) return { ok: false, error: 'title and missing required', text: 'report_gap needs a title and what is missing.' };
  const gap = { title: String(args.title), attempted: args.attempted, missing: String(args.missing), output: args.output };
  const gh = ctx.github;
  let filed = null;
  let why = '';
  if (gh && gh.token) {
    try { filed = await gapLib.fileGap(gap, gh, ctx.now(), args.folder); } catch (e) {
      const auth = /GitHub 40[13]\b/.test(e.message) ? ' The token was rejected: unset or replace PORTFOLIO_COPILOT_GITHUB_TOKEN (a cloud chat usually has none; the local log is the record).' : '';
      why = ` GitHub filing failed (${e.message}).${auth}`;
    }
  }
  const file = gapLib.logLocal(args.folder, gap, ctx.now(), filed && filed.url);
  const text = filed
    ? `Gap ${filed.action} on GitHub: ${filed.url}. Also logged to ${file}.`
    : `Gap logged to ${file}.${why}${gh && gh.token ? '' : ' No GitHub token configured (set PORTFOLIO_COPILOT_GITHUB_TOKEN), so no issue was filed.'}`;
  return { ok: true, filed, logged: file, text };
}

async function logAppend(args, ctx) {
  const { profile } = profiles.load(args.folder);
  const r = log.append(args.folder, { text: args.text, startHere: args.start_here, path: profile.log && profile.log.path }, ctx.now());
  return { ok: true, ...r, text: `Logged to ${r.path}${r.archived.length ? ` (archived ${r.archived.join(', ')})` : ''}.` };
}

// State bundle (US6): one file the cloud chat and the computer share.
async function stateExport(args, ctx) {
  if (!args.out) return { ok: false, error: 'out required', text: 'Pass out: the bundle file to write.' };
  const r = bundle.exportBundle(args.folder, args.out, ctx.now(), args.source || 'pc');
  return { ok: true, ...r, text: `State bundle written: ${r.path} (${Math.round(r.bytes / 1024)} KB, ${r.files.length} files).` };
}

async function stateImport(args) {
  if (!args.bundle || !args.into) return { ok: false, error: 'bundle and into required', text: 'Pass bundle (the file) and into (the folder to restore into).' };
  const r = bundle.importBundle(args.bundle, args.into, !!args.force);
  if (!r.ok) return { ok: false, error: 'newer copies in the target', newer: r.newer, text: `Not restored: ${r.newer.join(', ')} changed in ${args.into} after the bundle was made. Write those back first, or pass force to overwrite.` };
  return { ok: true, ...r, text: `Restored ${r.restored.length} files into ${args.into}. Use this folder as --folder, then state_writeback before you finish.` };
}

async function stateWriteback(args, ctx) {
  if (!args.bundle) return { ok: false, error: 'bundle required', text: 'Pass bundle: the bundle this folder was restored from.' };
  const r = bundle.writeback(args.bundle, args.folder, args.source_hashes || {}, ctx.now());
  const next = r.files.length ? [{ do: 'files', op: 'writeback', files: r.files }] : [];
  const L = [r.files.length ? `Copy back ${r.files.length} changed file(s): ${r.files.map((f) => f.path).join(', ')}.` : 'Nothing changed since the bundle.'];
  if (r.conflicts.length) L.push(`Conflicts (changed on the computer meanwhile, not copied): ${r.conflicts.join(', ')}. Tell the investor; do not overwrite.`);
  return { ok: true, next, conflicts: r.conflicts, text: L.join('\n') };
}

// Guardrails at a glance: each limit with its base, and the closest stop (spec 002, check).
function guardrails(snap, c, profile, prev) {
  const L = profile.limits;
  const top = c.positions.filter((p) => p.type === 'equity')[0];
  const sec = concentration.sectorExposure(snap, profile, c)[0];
  const fh = c.fund_houses.filter((h) => h.house !== 'UNKNOWN')[0];
  let stop = null;
  if (snap.brokers.kite && (snap.brokers.kite.gtts || []).length) {
    const rows = gtt.audit(snap, prev, profile).rows.filter((r) => r.stop_distance_pct !== null);
    stop = rows.sort((a, b) => a.stop_distance_pct - b.stop_distance_pct)[0] || null;
  }
  const rows = [
    ['Largest stock', top ? `${top.symbol} ${pct(top.pct_of_book)}` : '-', `${L.single_stock_pct}%`, 'whole book'],
    ['Largest sector', sec ? `${sec.sector} ${pct(sec.pct)}` : 'no sector map', `${L.sector_pct}%`, sec ? sec.base : '-'],
    ['Largest fund house', fh ? `${fh.house} ${pct(fh.pct_of_mf)}` : '-', `${L.fund_house_pct}%`, 'mutual fund holdings'],
    ['Closest stop', stop ? `${stop.symbol} ${stop.stop_distance_pct}% below` : '-', `${profile.gtt_policy.min_stop_distance_pct}% minimum`, 'last price'],
  ];
  if (!lossTolerance.notSet(profile).length) {
    const plays = snapshotLib.allHoldings(snap).filter((h) => lossTolerance.classOf(h, profile) === 'play' && typeof h.pnl_inr === 'number');
    const open = plays.filter((h) => h.pnl_inr < 0).reduce((a, h) => a - h.pnl_inr, 0);
    const play = plays.reduce((a, h) => a + h.pnl_inr, 0);
    rows.push(['Play losses (open)', `${inr(open)} (play P&L ${inr(play)})`, `${inr(profile.loss_tolerance.amount_inr)} ${profile.loss_tolerance.measure}`, 'open play positions; realised needs your tradebook (lots_build)']);
  }
  return `\n**Guardrails**\n${table(['Check', 'Now', 'Limit', 'Base'], rows)}`;
}

// What is due under the investor's rules, outside a review (US5). Saves nothing.
async function decisionsCmd(args, ctx) {
  const { profile } = profiles.load(args.folder);
  const snap = state.latestSnapshot(args.folder);
  if (!snap) return { ok: false, error: 'no snapshot yet', text: 'No data yet. Run refresh first.' };
  const prev = state.previousSnapshot(args.folder, istDate(new Date(snap.taken_at)));
  const input = review.ruleInput(args.folder, profile, snap, prev, ctx.now(), ctx.edition);
  const r = decisionsLib.evaluate(input, { today: istDate(ctx.now()), live: Object.entries(snap.brokers).filter(([, b]) => b.status === 'live').map(([n]) => n) });
  const L = [`**Decisions due** · data ${istStamp(new Date(snap.taken_at))}`];
  r.tasks.forEach((t, i) => L.push(`${i + 1}. ${t.title} · ${t.executor}\n   Why: your rule ${t.why.rule_ref}: ${t.why.measurements.map((m) => (m.name === 'finding' ? m.value : `${m.name.replace(/_/g, ' ')} ${m.value} (base: ${m.base})`)).join('; ')}`));
  if (!r.tasks.length) L.push('Nothing due under your rules.');
  if (r.also_due) L.push(`Also due: ${r.also_due}`);
  if (r.not_set.length) L.push(`Not set: ${r.not_set.join(', ')}`);
  L.push('Say "review" to decide them.');
  return { ok: true, tasks: r.tasks, also_due: r.also_due, not_set: r.not_set, text: L.join('\n') };
}

async function journalReadback(args, ctx) {
  const { profile } = profiles.load(args.folder);
  const days = args.older_than_days !== undefined ? Number(args.older_than_days) : profile.review.readback_after_days;
  const snap = state.latestSnapshot(args.folder);
  const prev = snap ? state.previousSnapshot(args.folder, istDate(new Date(snap.taken_at))) : null;
  const current = snap ? decisionsLib.evaluate(review.ruleInput(args.folder, profile, snap, prev, ctx.now(), ctx.edition)).all : [];
  const rows = journalLib.readback(args.folder, { olderThanDays: days, now: ctx.now(), current });
  return { ok: true, decisions: rows, text: rows.length ? [`**Decisions older than ${days} days**`, ...rows.map((r) => `- ${r.text}`)].join('\n') : `No decisions older than ${days} days yet.` };
}

// What the profit lock would do at the given thresholds (FR-031). Saves nothing.
async function profitLockDryrun(args, ctx) {
  for (const k of ['arm_gain_pct', 'book_gain_pct', 'trail_pct']) if (typeof args[k] !== 'number') return { ok: false, error: `${k} required`, text: 'Pass arm_gain_pct, book_gain_pct and trail_pct (numbers); scope play or all_stocks.' };
  if (!(args.arm_gain_pct > 0 && args.arm_gain_pct < args.book_gain_pct && args.trail_pct > 0)) return { ok: false, error: 'bad thresholds', text: 'Need 0 < arm_gain_pct < book_gain_pct and trail_pct > 0.' };
  const { profile } = profiles.load(args.folder);
  const snap = state.latestSnapshot(args.folder);
  if (!snap || !snap.brokers.kite) return { ok: false, error: 'no Kite data', text: 'No Kite snapshot yet. Run refresh first.' };
  const p = profiles.merge(profile, { gtt_policy: { profit_lock: { enabled: true, scope: args.scope || 'play' } } });
  const rows = profitLock.states(snap, p, marksLib.load(args.folder), args, profitLock.stopsOf(snap, profile), { dry: true });
  const label = { idle: 'nothing', armed: 'arm: stop to cost', book: 'book a slice', trailing: 'trail the stop' };
  const L = [`**Profit-lock dry run** · arm ${args.arm_gain_pct}% · book ${args.book_gain_pct}% · trail ${args.trail_pct}% · scope ${args.scope || 'play'} · data ${istStamp(new Date(snap.taken_at))} · nothing saved`,
    table(['Holding', 'Gain over cost', 'Stop vs cost', 'Would', 'Proposed stop'], rows.map((r) => [r.symbol, pct(r.gain_pct), r.stop_vs_cost_pct === null ? 'no stop' : pct(r.stop_vs_cost_pct), label[r.want], r.proposed_stop === null ? '-' : r.proposed_stop]))];
  return { ok: true, rows, text: L.join('\n') };
}

// Lots from imported statements (US8): FIFO, reconciled to what is held now.
async function lotsBuild(args, ctx) {
  if (!args.tradebook_csv && !args.mf_statement_csv) return { ok: false, error: 'a statement is required', text: 'Pass tradebook_csv and/or mf_statement_csv (CSV files exported from your broker or registrar).' };
  for (const p of [args.tradebook_csv, args.mf_statement_csv].filter(Boolean)) if (!/\.csv$/i.test(p) || !fs.existsSync(p)) return { ok: false, error: `not a CSV file: ${p}`, text: `${p} is not a CSV file I can read. Export the statement as CSV.` };
  const { profile } = profiles.load(args.folder);
  const snap = state.latestSnapshot(args.folder);
  const held = {};
  for (const b of Object.values((snap && snap.brokers) || {})) for (const h of b.holdings || []) for (const k of [h.symbol, h.isin].filter(Boolean)) held[String(k).toUpperCase()] = (held[String(k).toUpperCase()] || 0) + h.qty;
  const lots = lotsLib.build({ tradebook: args.tradebook_csv, mfStatement: args.mf_statement_csv, held, now: ctx.now(), fyStartMonth: profile.tax.fy_start_month || 4 });
  lotsLib.save(args.folder, lots);
  const off = Object.entries(lots.symbols).filter(([, s]) => s.held_qty !== null && !s.reconciled);
  const L = [`**Lots built** from ${lots.sources.join(', ')} · ${Object.keys(lots.symbols).length} symbols · realised in ${lots.realised.fy}: short-term ${inr(lots.realised.stcg_inr)}, long-term ${inr(lots.realised.ltcg_inr)}`];
  L.push(off.length ? `Does not match what you hold: ${off.map(([sym, s]) => `${sym} (lots ${s.lots_qty}, held ${s.held_qty})`).join(', ')}. Tax on those uses the lots as imported.` : 'Every imported holding reconciles to what you hold.');
  if (lots.problems.length) L.push(`Problems: ${lots.problems.join('; ')}`);
  L.push(lotsLib.ratesSet(profile.tax) ? `Rates as of ${profile.tax.as_of}; ${lotsLib.ADVISER}.` : 'Save your tax rates and exemption (tax.*, with as_of) to see the tax on each sell.');
  return { ok: true, symbols: Object.keys(lots.symbols).length, unreconciled: off.map(([s]) => s), realised: lots.realised, text: L.join('\n') };
}

// Dashboard files (T083): positions and cash in the dashboard's shape; missing technicals are null.
async function exportCmd(args, ctx) {
  if ((args.format || 'dashboard') !== 'dashboard') return { ok: false, error: 'format: dashboard', text: 'Only format dashboard is supported.' };
  const snap = state.latestSnapshot(args.folder);
  if (!snap) return { ok: false, error: 'no snapshot yet', text: 'No data yet. Run refresh first.' };
  const { profile } = profiles.load(args.folder);
  const out = args.out || path.join(state.stateDir(args.folder), 'dashboard');
  const r = exportLib.write(args.folder, out, snap, state.previousSnapshot(args.folder, istDate(new Date(snap.taken_at))), profile);
  return { ok: true, ...r, text: `Dashboard files written (${r.positions} positions, data ${istStamp(new Date(snap.taken_at))}): ${r.files.join(', ')}. Load them into the dashboard.` };
}

// Setups, watchlist, deployment split, intraday and retro (issues #34 to #38).
function priceMap(folder, symbols) {
  return pricesFor(symbols, state.latestSnapshot(folder));
}

function setupRows(folder, symbols) {
  const prices = priceMap(folder, symbols);
  const techs = technicals.forSnapshot(technicals.load(folder));
  return setupsLib.rows(symbols.map((symbol) => ({ symbol, ltp: prices[symbol] })), techs);
}

function setupTable(rows) {
  const f = (n) => (n === null || n === undefined ? '-' : n);
  return table(['Symbol', 'LTP', 'Setup', 'R:R', '50d', '200d', 'RSI', '20d low', '52w high', 'Closes', 'As of'], rows.map((r) => [r.symbol, f(r.ltp), r.setup, f(r.rr), f(r.dma50), f(r.dma200), f(r.rsi), f(r.sup20), f(r.hi52), r.closes, f(r.as_of)]));
}

async function setupsCmd(args) {
  const { profile } = profiles.load(args.folder);
  const snap = state.latestSnapshot(args.folder);
  const held = snap ? snapshotLib.allHoldings(snap).filter((h) => h.type !== 'mf' && !h.frozen).map((h) => h.symbol) : [];
  const symbols = (args.symbols && args.symbols.length ? args.symbols : [...held, ...profile.watchlist.symbols.map((x) => x.symbol)]).map((s) => s.toUpperCase());
  const uniq = [...new Set(symbols)];
  if (!uniq.length) return { ok: false, error: 'no symbols', text: 'No holdings, no watchlist and no symbols given.' };
  const rows = setupRows(args.folder, uniq);
  const note = 'Setups come from the engine\'s own daily closes: each refresh adds one, so a new name shows "Short history" until it has 50. Seed history with closes_seed (daily closes from the broker\'s historical data). A setup describes the chart, never a call to buy or sell.';
  return { ok: true, rows, text: `**Setups** (rules in core/lib/setups.js: below the 200-day (50-day if none) is Downtrend; above it but below the 50-day is a Dip; more than ${setupsLib.STRETCH_ABOVE_DMA50_PCT}% above the 50-day or RSI at or over ${setupsLib.STRETCH_RSI} is Stretched; else In uptrend)\n${setupTable(rows)}\n${note}` };
}

async function closesSeed(args) {
  const sym = (args.symbol || '').toUpperCase();
  const rows = args.rows;
  if (!sym || !Array.isArray(rows) || !rows.length) return { ok: false, error: 'symbol and rows required', text: 'Pass symbol and rows: [{ date: "YYYY-MM-DD", close: number }] (daily closes from the broker\'s historical data).' };
  const bad = rows.find((r) => !/^\d{4}-\d{2}-\d{2}$/.test(r.date) || typeof r.close !== 'number' || !(r.close > 0));
  if (bad) return { ok: false, error: 'bad row', text: `Every row needs date YYYY-MM-DD and a close above 0; got ${JSON.stringify(bad)}.` };
  const n = technicals.merge(args.folder, sym, rows);
  return { ok: true, symbol: sym, closes: n, text: `${sym}: ${n} daily closes stored (latest ${rows.map((r) => r.date).sort().pop()}).` };
}

async function watchlistCmd(args, ctx) {
  const { profile } = profiles.load(args.folder);
  const w = JSON.parse(JSON.stringify(profile.watchlist));
  const day = istDate(ctx.now());
  const action = args.action || 'list';
  const sym = (args.symbol || '').toUpperCase();
  let changed = true;
  if (action === 'add') {
    if (!sym) return { ok: false, error: 'symbol required', text: 'Pass symbol.' };
    const cur = w.symbols.find((x) => x.symbol === sym);
    if (cur) Object.assign(cur, args.note !== undefined ? { note: args.note } : {});
    else w.symbols.push({ symbol: sym, added: day, source: args.source || 'investor', ...(args.note ? { note: args.note } : {}) });
  } else if (action === 'remove') {
    w.symbols = w.symbols.filter((x) => x.symbol !== sym);
  } else if (action === 'save_screen') {
    if (!args.name || !(args.url || args.query)) return { ok: false, error: 'name and url or query required', text: 'Pass name and the screen\'s url or query text.' };
    const rest = w.screens.filter((x) => x.name !== args.name);
    const old = w.screens.find((x) => x.name === args.name) || {};
    w.screens = [...rest, { ...old, name: args.name, ...(args.url ? { url: args.url } : {}), ...(args.query ? { query: args.query } : {}) }];
  } else if (action === 'remove_screen') {
    w.screens = w.screens.filter((x) => x.name !== args.name);
  } else if (action === 'record_results') {
    const scr = w.screens.find((x) => x.name === args.name);
    if (!scr || !Array.isArray(args.symbols)) return { ok: false, error: 'saved screen name and symbols required', text: 'Pass name (a saved screen) and symbols (its results).' };
    const syms = args.symbols.map((x) => String(x).toUpperCase());
    scr.last_run = day;
    scr.last_results = syms;
    for (const s of syms) if (!w.symbols.some((x) => x.symbol === s)) w.symbols.push({ symbol: s, added: day, source: `screen:${scr.name}` });
  } else if (action === 'list') {
    changed = false;
  } else return { ok: false, error: `unknown action ${action}`, text: 'action: list, add, remove, save_screen, remove_screen or record_results.' };
  if (changed) {
    const r = profiles.update(args.folder, 'watchlist', w);
    if (r && r.errors && r.errors.length) return { ok: false, error: r.errors.join('; '), text: `Not saved: ${r.errors.join('; ')}` };
  }
  const L = [`**Watchlist** · ${w.symbols.length} names · ${w.screens.length} saved screens · ${istStamp(ctx.now())}`, 'Names the investor follows or a screen returned: screen output, not recommendations.'];
  if (w.symbols.length) L.push(setupTable(setupRows(args.folder, w.symbols.map((x) => x.symbol))));
  if (w.screens.length) L.push(table(['Screen', 'Where', 'Last run', 'Results'], w.screens.map((x) => [x.name, x.url || x.query, x.last_run || 'never', (x.last_results || []).length])));
  return { ok: true, watchlist: w, text: L.join('\n') };
}

async function deployCmd(args, ctx) {
  const { profile } = profiles.load(args.folder);
  const snap = state.latestSnapshot(args.folder);
  const kite = snap && snap.brokers.kite;
  const cash = typeof args.cash === 'number' ? args.cash : kite ? kite.cash : null;
  if (typeof cash !== 'number') return { ok: false, error: 'cash required', text: 'No Kite cash in the snapshot. Pass cash, or run refresh first.' };
  const destinations = args.destinations || profile.deployment_plan.destinations;
  if (!destinations || !destinations.length) return { ok: false, error: 'no destinations', text: 'No destinations given and none saved in deployment_plan.destinations.' };
  let gap = typeof args.global_gap_inr === 'number' ? args.global_gap_inr : 0;
  if (typeof args.global_gap_inr !== 'number' && snap) {
    const c = snapshotLib.consolidate(snap, profile);
    const g = c.allocation.find((a) => a.bucket === 'global_equity');
    if (g && g.target_pct !== null && g.drift_pp < 0) gap = (-g.drift_pp / 100) * c.totals.book;
  }
  const syms = destinations.map((d) => d.symbol.toUpperCase());
  const dest = destinations.map((d) => ({ ...d, symbol: d.symbol.toUpperCase() }));
  const rows = setupRows(args.folder, syms);
  const setups = Object.fromEntries(rows.map((r) => [r.symbol, r.closes ? r.setup : null]));
  const sup20 = Object.fromEntries(rows.filter((r) => r.sup20 !== null).map((r) => [r.symbol, r.sup20]));
  const r = deployLib.split({ cash, keep_cash: args.keep_cash || 0, global_gap_inr: gap, destinations: dest, valuations: args.valuations || {}, setups, sup20, stage_metals: args.stage_metals !== false, dip_days: args.dip_days, today: istDate(ctx.now()) });
  const L = [`**Deployment split** · cash ${inr(cash)} · keep ${inr(r.keep_cash)} · ${istStamp(ctx.now())}`];
  L.push(`Global gap ${inr(gap)}: ${inr(r.to_global)} goes first as a transfer to the global broker (a bank wire, not an order here). Then ${inr(r.rest)} across your destinations.`);
  L.push(table(['Symbol', 'Setup', 'Planned', 'Now', 'Held back', 'Why'], r.rows.map((x) => [x.symbol, x.setup || 'no setup data', inr(x.planned), inr(x.amount_now), inr(x.held_back), x.why.join('; ')])));
  L.push(`Invest now ${inr(r.invest_now)} · held back ${inr(r.held_back)} · cash after ${inr(r.cash_after)}`);
  if (r.dip_limits.length) L.push(`Dip limits to consider (proposals, each with a deadline; none is placed): ${r.dip_limits.map((x) => `${x.symbol} ${x.qty} at ${x.price} until ${x.valid_until}`).join('; ')}`);
  if (r.invest_now > 0) L.push(`Next: draft_basket with amount ${r.invest_now} and destinations ${JSON.stringify(r.destinations)}.`);
  return { ok: true, ...r, amount: r.invest_now, text: L.join('\n') };
}

async function intradayPlan(args, ctx) {
  const { profile } = profiles.load(args.folder);
  const p = intraday.plan({ candles: args.candles, side: args.side, risk_inr: args.risk_inr, product: args.product, entry: args.entry, target_r: args.target_r }, profile);
  if (!p.ok) return { ok: false, error: p.error, text: `No plan: ${p.error}.` };
  const sym = (args.symbol || '').toUpperCase();
  const call = args.log && sym ? intraday.logCall(args.folder, sym, p, ctx.now(), istDate(ctx.now())) : null;
  const f = (n) => (n === null ? '-' : n);
  const L = [`**Intraday plan** ${sym} ${p.side} ${p.product} · ${p.levels.candles} candles · opening range ${f(p.levels.or_low)}-${f(p.levels.or_high)} · VWAP ${f(p.levels.vwap)} · 20 EMA ${f(p.levels.ema20)}`,
    table(['Entry', 'Stop (structure)', 'Target', 'Qty', 'Risk', 'Reward', 'Charges at target', 'Net R:R'], [[p.entry, p.stop, p.target, p.qty, inr(p.risk_gross), inr(p.reward_gross), `${inr(p.charges_at_target)} (${p.charges_per_share}/share)`, p.net_rr]])];
  if (p.default_rates) L.push(`Charges use a built-in default rate (${p.rates_source}): save your own as profile.charges (with as_of and source) and check them against the broker's calculator.`);
  L.push(call ? `Logged as ${call.id} for the retro. Watch it with intraday_watch.` : 'Not logged. Pass log: true with symbol to log it for the retro.');
  L.push('A plan from the candles given: levels, not a prediction.');
  return { ok: true, plan: p, call, text: L.join('\n') };
}

async function intradayWatch(args, ctx) {
  const rows = intraday.watch(args.folder, istDate(ctx.now()), args.prices || {});
  if (!rows.length) return { ok: true, calls: [], text: 'No intraday calls logged today.' };
  return { ok: true, calls: rows, text: `**Intraday calls today** · ${istStamp(ctx.now())}\n${table(['Id', 'Symbol', 'Side', 'Entry', 'Stop', 'Target', 'LTP', 'State'], rows.map((r) => [r.id, r.symbol, r.side, r.entry, r.stop, r.target, r.ltp ?? '-', r.state]))}` };
}

async function retroCmd(args, ctx) {
  const { profile } = profiles.load(args.folder);
  const day = args.date || istDate(ctx.now());
  const r = intraday.retro(args.folder, day, args.candles || {}, profile);
  if (!r.calls) return { ok: true, ...r, text: `No intraday calls logged for ${day}.` };
  const L = [`**Retro ${day}** · ${r.calls} calls · won ${r.won} · lost ${r.lost} · net after charges ${inr(r.net)} (charges ${inr(r.charges)})`,
    table(['Id', 'Symbol', 'Side', 'Entry', 'Stop', 'Target', 'Outcome', 'Exit', 'Net'], r.results.map((x) => [x.id, x.symbol, x.side, x.entry, x.stop, x.target, x.outcome, x.exit ?? '-', x.net ?? '-']))];
  L.push('Replay rule: the candles after the call; a candle that touches both stop and target counts as stopped.');
  if (!lossTolerance.notSet(profile).length) L.push(`Losses on these calls ${inr(r.losses)} against your tolerance ${inr(profile.loss_tolerance.amount_inr)} (${profile.loss_tolerance.measure}${profile.loss_tolerance.from ? `, from ${profile.loss_tolerance.from}` : ''}); the tolerance is for its own window, so add earlier play losses before comparing.`);
  if (r.default_rates) L.push('Charges use a built-in default rate: save your own as profile.charges.');
  return { ok: true, ...r, text: L.join('\n') };
}

// End of session (issue #41): one dated entry for the next chat to start from.
async function closeSession(args, ctx) {
  const { profile, exists } = profiles.load(args.folder);
  if (!exists) return { ok: false, error: 'no profile', text: `Not saved: no profile.json at ${profiles.profilePath(args.folder)}. This looks like an uploaded copy or the wrong folder. Point folder at the real investor folder on the computer, then close the session.` };
  const sections = [['Decisions', args.decisions], ['Strategies', args.strategies], ['Trades', args.trades], ['Tools built', args.tools]];
  const body = sections.filter(([, v]) => Array.isArray(v) && v.length).map(([k, v]) => `**${k}**\n${v.map((x) => `- ${x}`).join('\n')}`).join('\n\n');
  if (!body && !args.start_here) return { ok: false, error: 'nothing to save', text: 'Pass decisions, strategies, trades, tools or start_here.' };
  const r = log.append(args.folder, { text: `Session summary\n\n${body}`.trim(), startHere: args.start_here, path: profile.log && profile.log.path }, ctx.now());
  return { ok: true, ...r, text: `Session saved to ${r.path}${args.start_here ? ' (Start here rewritten)' : ''}. Copy the Start here block into the claude.ai Project's current-state doc so the next chat starts from it; nothing here reaches the Project by itself.` };
}

// Guided review (US3): one run, stage by stage, gates in code.
function reviewDeps(args, ctx) {
  return {
    edition: ctx.edition,
    connect: connectLib.connect,
    refresh: (folder) => refresh({ folder }, ctx),
    latestSnapshot: state.latestSnapshot,
    previousSnapshot: state.previousSnapshot,
    draft: (folder, t) => draftGttPlan({ folder, symbols: [t.symbol], corporate_actions: args.corporate_actions || [] }, ctx),
    log: (folder, text) => { const { profile } = profiles.load(folder); return log.append(folder, { text, path: profile.log && profile.log.path }, ctx.now()); },
    exportBundle: (folder) => bundle.exportBundle(folder, path.join(state.stateDir(folder), 'bundle.json'), ctx.now()),
    exportDashboard: (folder) => { const s = state.latestSnapshot(folder); const { profile } = profiles.load(folder); return exportLib.write(folder, path.join(state.stateDir(folder), 'dashboard'), s, state.previousSnapshot(folder, istDate(new Date(s.taken_at))), profile); },
    record: args.record,
  };
}
// Without run: today's open run of any kind, else today's full run.
const runId = (args, ctx) => args.run || review.current(args.folder, ctx.now());

async function reviewStart(args, ctx) {
  const tools = Array.isArray(args.tools) ? args.tools.map(String) : [];
  const { run, resumed } = review.start(args.folder, { kind: args.kind || 'full', unattended: !!args.unattended, tools }, ctx.now());
  const r = await review.next(args.folder, run.id, ctx.now(), reviewDeps(args, ctx));
  return { ...r, resumed, text: `${resumed ? 'Resuming' : 'Started'} ${run.id}.\n${r.text}` };
}

async function reviewNext(args, ctx) {
  return review.next(args.folder, runId(args, ctx), ctx.now(), reviewDeps(args, ctx));
}

async function reviewStatus(args, ctx) {
  const run = review.load(args.folder, runId(args, ctx));
  if (!run) return { ok: false, error: 'no run', text: 'No review run today. Say "review" to start one.' };
  const st = run.stages[run.stage] || {};
  const L = [`**Review ${run.id}** · stage ${run.stage}${st.status === 'waiting' ? ` · waiting: ${st.reason}` : ''}`];
  for (const t of run.tasks) L.push(`- ${t.title}: ${t.decision || 'undecided'}${t.outcome ? `, ${t.outcome}` : ''}`);
  return { ok: true, run, text: L.join('\n') };
}

async function taskDecide(args, ctx) {
  const id = runId(args, ctx);
  const r = review.decide(args.folder, id, args, ctx.now());
  if (!r.ok) return { ...r, run: id, text: r.error };
  return { ok: true, run: id, task: r.task, text: `${r.task.title}: ${r.task.decision}.${r.task.decision === 'approved' ? ' This authorises a draft, not an order.' : ''} Call review_next when every task is decided.` };
}

async function taskDone(args, ctx) {
  const id = runId(args, ctx);
  const r = review.done(args.folder, id, args, ctx.now());
  if (!r.ok) return { ...r, run: id, text: r.error };
  return { ok: true, run: id, task: r.task, text: `${r.task.title}: ${r.task.outcome}. A fresh read will verify it.` };
}

async function researchSubmit(args, ctx) {
  const id = runId(args, ctx);
  const r = review.submitResearch(args.folder, id, { findings: args.findings || [], corporate_actions: args.corporate_actions }, ctx.now());
  if (!r.ok) return { ...r, run: id, text: r.error };
  const L = [`Accepted ${r.accepted.length} finding(s).${Array.isArray(args.corporate_actions) ? ` Corporate-action check recorded (${args.corporate_actions.length} found).` : ''}`];
  for (const x of r.rejected) L.push(`Rejected ${(x.finding && x.finding.symbol) || '?'} ${(x.finding && x.finding.metric) || ''}: ${x.reasons.join('; ')}`);
  return { ok: true, run: id, ...r, text: L.join('\n') };
}

// Rows for orders the plan builders do not draft (IBKR instructions, cancel or modify an open order).
// A row names the broker and the operation, and the tool map writes the call; or it gives the
// call itself, which must be an order write the map knows.
const ORDER_OPS = ['place', 'modify', 'cancel', 'delete'];

function orderRow(r, i) {
  const base = { step: i + 1, symbol: r.symbol || '', reason: r.reason || '' };
  if (r.op) {
    if (!ORDER_OPS.includes(r.op)) return { error: `op must be one of ${ORDER_OPS.join(', ')}` };
    const broker = r.broker || 'kite';
    try {
      return { ...base, cap: 'order_write', ...toolmap.writeCall(broker, 'order_write', r.op, r.args || {}, broker === 'kite' ? inputs.genOf('kite') : 1) };
    } catch (e) { return { error: e.message }; }
  }
  const tool = String(r.tool || '');
  const args = r.args || {};
  const m = toolmap.resolve(r.broker ? `mcp__${r.broker}__${tool}` : tool, args);
  if (m.kind !== 'write' || m.cap !== 'order_write' || m.mode === 'permissions') return { error: `${tool}${m.mode ? ` mode ${m.mode}` : ''} is not an order call portfolio-copilot drafts` };
  return { ...base, cap: 'order_write', tool, args };
}

async function draftOrders(args, ctx) {
  if (!(args.rows || []).length) return { ok: false, error: 'rows required', text: 'Give rows: [{broker, op, args, symbol?, reason?}].' };
  const rows = args.rows.map(orderRow);
  const badIdx = rows.findIndex((r) => r.error);
  if (badIdx >= 0) return { ok: false, error: rows[badIdx].error, text: `Row ${badIdx + 1}: ${rows[badIdx].error}.` };
  const d = drafts.create(args.folder, 'orders', rows, { label: args.label || 'orders' });
  const how = ctx.edition === 'lite'
    ? 'Enter these at the broker yourself.'
    : `To execute: ask the investor with AskUserQuestion. Header "${d.code}"; question naming ${d.code} with one line per row above; options in this order: "No, don't place", then "Yes, place ${d.code}". Never pre-fill answers. After Yes, make the calls below. If the broker answers that a call needs its own approval, show its approval link or step to the investor and wait; never approve it yourself.\n\n${callsBlock(d)}`;
  return { ok: true, code: d.code, rows: rows.length, text: [`**Order draft ${d.code}** · ${d.label}`, table(['#', 'Tool', 'Symbol', 'Arguments', 'Why'], rows.map((r) => [r.step, r.tool, r.symbol, JSON.stringify(r.args), r.reason])), `\n${how}`].join('\n') };
}

// ---------------------------------------------------------------------------------------

const TOOLS = [
  { name: 'broker_status', handler: brokerStatus, description: 'Alias of connect, using the broker tools captured in this chat. Prefer connect with the tool names you can see. Pass hook_plugin and hook_version from the session-start context so a version or edition mismatch is reported.', props: { hook_plugin: { type: 'string' }, hook_version: { type: 'string' } } },
  { name: 'connect', handler: connect, description: 'Connect every enabled broker before any work. Pass tools: every broker MCP tool name you can see. Returns next (the exact broker calls to make, in order), manual (every human step for all brokers at once: ask once) and ready. Repeat: do next, ask manual, call connect again, until ready; then show text. skip: brokers to leave out. unattended: true for scheduled runs (never asks for a login).', props: { tools: { type: 'array', items: { type: 'string' } }, skip: { type: 'array', items: { type: 'string' } }, unattended: { type: 'boolean' }, hook_plugin: { type: 'string' }, hook_version: { type: 'string' } }, required: ['tools'] },
  { name: 'refresh', handler: refresh, description: "Build today's snapshot from the broker reads captured in this chat (call the broker MCP read tools first), and return the consolidated portfolio check (totals, cash, alerts, trade audit, changes since last snapshot).", props: { brokers: { type: 'array', items: { type: 'string' } } } },
  { name: 'ingest', handler: ingest, description: "Add holdings from a broker core does not connect to (IBKR connector output, or a holdings CSV statement) to today's snapshot. Foreign currency needs fx_rate and fx_source.", props: { broker: { type: 'string' }, holdings: { type: 'array', items: { type: 'object' } }, csv_path: { type: 'string' }, cash: { type: 'number' }, currency: { type: 'string' }, fx_rate: { type: 'number' }, fx_source: { type: 'string' }, source: { type: 'string' } }, required: ['broker'] },
  { name: 'check', handler: check, description: 'Re-render the consolidated portfolio check from the latest snapshot without pulling brokers.', props: {} },
  { name: 'gtt_audit', handler: gttAudit, description: "Audit Kite GTTs against the investor's policy: per-symbol quantity gaps, policy violations, crash test, outliers, orphans, cancelled GTTs, corporate-action re-scoring.", props: { corporate_actions: { type: 'array', items: { type: 'object', properties: { symbol: { type: 'string' }, kind: { type: 'string', enum: ['bonus', 'split', 'demerger', 'dividend'] }, ratio: { type: 'string' }, price_factor: { type: 'number' }, ex_date: { type: 'string' }, confirmed: { type: 'boolean' } } } } } },
  { name: 'draft_gtt_plan', handler: draftGttPlan, description: 'Draft GTT changes that bring the book in line with policy. New GTTs are placed before old ones are deleted. Returns a draft code.', props: { symbols: { type: 'array', items: { type: 'string' } }, corporate_actions: { type: 'array', items: { type: 'object' } } } },
  { name: 'draft_basket', handler: draftBasket, description: 'Draft basket rows (symbol, qty, LIMIT price) for an amount or a saved deployment stage, for manual entry in Kite web.', props: { amount: { type: 'number' }, stage: { type: 'number' }, destinations: { type: 'array', items: { type: 'object' } }, format: { type: 'string', enum: ['kite_json'], description: 'Also write a file Kite web can import as a basket.' } } },
  { name: 'crash_check', handler: crashCheck, description: "Crash mode: stops that would fire, stops that would force-sell hold names, and which stage of the investor's saved deployment plan the index has reached (drafts that stage's basket).", props: { index_level: { type: 'number' } } },
  { name: 'rate_map', handler: rateMap, description: 'Group holdings by interest-rate sensitivity (default map plus profile overrides).', props: {} },
  { name: 'profile_get', handler: profileGet, description: "Read the investor's profile (or a dotted path in it).", props: { path: { type: 'string' } } },
  { name: 'profile_update', handler: profileUpdate, description: 'Set one dotted path in the profile (e.g. cash.buffer_location = "bank", verdicts.SBIN = {stance, reason}). Validated before saving. Only on the investor\'s instruction.', props: { path: { type: 'string' }, value: {} }, required: ['path'] },
  { name: 'protection_check', handler: protectionCheck, description: "Report the emergency fund against 6-12 months of expenses, term and health cover, and the SIP list, all from the investor's saved profile inputs.", props: {} },
  { name: 'verdict_notes', handler: verdictNotes, description: 'Render the saved verdicts (with reasons, exit levels and stop decisions) as text the investor can paste into their notes file.', props: {} },
  { name: 'report_gap', handler: reportGap, description: 'Record something the plugin cannot do: always logged to the feedback file, and filed as a GitHub issue labelled gap (or commented on an open duplicate) when a token is configured. Never include quantities, prices or P&L. flush: true files the gaps the hooks queued (unknown broker tools) instead.', props: { title: { type: 'string' }, attempted: { type: 'string' }, missing: { type: 'string' }, output: { type: 'string' }, flush: { type: 'boolean' } } },
  { name: 'doctor', handler: doctor, description: 'Check which broker MCP tools this chat has: per enabled broker, whether it can read and write, which tools the plugin does not know, and the exact read calls to make. Pass tools: every broker tool name you can see. Run at session start and whenever a broker read fails with an unknown tool.', props: { tools: { type: 'array', items: { type: 'string' } } }, required: ['tools'] },
  { name: 'state_export', handler: stateExport, description: "Write the investor's state (profile, last two snapshots, open drafts, today's runs, marks, journal tail, log) to one bundle file, for a cloud chat to work on.", props: { out: { type: 'string' }, source: { type: 'string' } }, required: ['out'] },
  { name: 'state_import', handler: stateImport, description: 'Restore a state bundle into a folder. Refuses when the folder holds newer copies, unless force.', props: { bundle: { type: 'string' }, into: { type: 'string' }, force: { type: 'boolean' } }, required: ['bundle', 'into'] },
  { name: 'state_writeback', handler: stateWriteback, description: 'List the files changed since a bundle was restored, as a files writeback step to copy to the computer. Pass source_hashes (path to sha256 of the computer copy) to catch conflicts. Writes nothing itself.', props: { bundle: { type: 'string' }, source_hashes: { type: 'object' } }, required: ['bundle'] },
  { name: 'review_start', handler: reviewStart, description: 'Start (or resume) the guided review for today. kind: full (default), eod or friday. tools: every broker MCP tool name you can see. Returns next: do each step, then call review_next, until stage is closed.', props: { kind: { type: 'string', enum: ['full', 'eod', 'friday'] }, unattended: { type: 'boolean' }, tools: { type: 'array', items: { type: 'string' } } } },
  { name: 'review_next', handler: reviewNext, description: 'Run the current review stage once. Returns the gate, next steps and text. Loop: do next, call review_next, until stage is closed. At record, pass record: { todoist: synced | skipped, dashboard: updated | skipped } once done.', props: { run: { type: 'string' }, corporate_actions: { type: 'array', items: { type: 'object' } }, record: { type: 'object', properties: { todoist: { type: 'string', enum: ['synced', 'skipped'] }, dashboard: { type: 'string', enum: ['updated', 'skipped'] } } } } },
  { name: 'review_status', handler: reviewStatus, description: 'Where the review run stands: stage, gate, each task with its decision and outcome. Read-only.', props: { run: { type: 'string' } } },
  { name: 'task_decide', handler: taskDecide, description: "Record the investor's answer to a task question (Approve, Defer, Decline). Approving authorises a draft, never an order.", props: { run: { type: 'string' }, task: { type: 'string' }, decision: { type: 'string', enum: ['approved', 'deferred', 'declined'] }, reason: { type: 'string' }, defer_until: { type: 'string' }, option: { type: 'string' } }, required: ['task', 'decision'] },
  { name: 'task_done', handler: taskDone, description: 'After the investor says done on a task they carry out themselves. result: done, could_not or skipped. A fresh read still verifies it. On a plugin task the fresh read did not confirm, only could_not (with a note), when the investor says it could not be done.', props: { run: { type: 'string' }, task: { type: 'string' }, result: { type: 'string', enum: ['done', 'could_not', 'skipped'] }, note: { type: 'string' } }, required: ['task', 'result'] },
  { name: 'research_submit', handler: researchSubmit, description: 'Submit research findings for the review brief: symbol, metric, value, period, source_url, source_quote, accessed, status (found, not_found, blocked_source). Pass corporate_actions (an array, empty when none) once checked.', props: { run: { type: 'string' }, findings: { type: 'array', items: { type: 'object' } }, corporate_actions: { type: 'array', items: { type: 'object' } } } },
  { name: 'lots_build', handler: lotsBuild, description: "Build tax lots first-in first-out from the investor's tradebook and fund statement (CSV only) and reconcile them to what is held. Sell options then show lots, holding periods, gains and the exemption left.", props: { tradebook_csv: { type: 'string' }, mf_statement_csv: { type: 'string' } } },
  { name: 'export', handler: exportCmd, description: 'Write the dashboard files (positions-<date>.json with setup and R:R, cash-<date>.json, watchlist-<date>.json) from the latest snapshot. format: dashboard; out: a folder (default the state folder).', props: { format: { type: 'string', enum: ['dashboard'] }, out: { type: 'string' } } },
  { name: 'profit_lock_dryrun', handler: profitLockDryrun, description: 'What the profit lock would arm, book or trail today at the thresholds given (arm_gain_pct, book_gain_pct, trail_pct; scope play or all_stocks). Saves nothing.', props: { arm_gain_pct: { type: 'number' }, book_gain_pct: { type: 'number' }, trail_pct: { type: 'number' }, scope: { type: 'string', enum: ['play', 'all_stocks'] } }, required: ['arm_gain_pct', 'book_gain_pct', 'trail_pct'] },
  { name: 'decisions', handler: decisionsCmd, description: "What is due under the investor's own rules (GTT gaps, tripwires, limits, drift, plan path, loss tolerance), outside a review. Saves nothing.", props: {} },
  { name: 'journal_readback', handler: journalReadback, description: 'Decisions older than older_than_days (default from the profile) beside what the same rules measure now.', props: { older_than_days: { type: 'number' } } },
  { name: 'log_append', handler: logAppend, description: 'Append a dated entry to the log and optionally rewrite the "Start here" block. Older months archive automatically.', props: { text: { type: 'string' }, start_here: { type: 'string' } } },
  { name: 'draft_orders', handler: draftOrders, description: 'Draft explicit broker order calls (an IBKR order instruction, cancel or modify an open Kite order) so the order gate can allow exactly those calls once the investor clicks Yes. Each row gives broker (kite or ibkr), op (place, modify, cancel) and the order arguments; the engine names the broker tool.', props: { label: { type: 'string' }, rows: { type: 'array', items: { type: 'object', properties: { broker: { type: 'string' }, op: { type: 'string' }, tool: { type: 'string' }, args: { type: 'object' }, symbol: { type: 'string' }, reason: { type: 'string' } } } } }, required: ['rows'] },
  { name: 'setups', handler: setupsCmd, description: 'Technical setup per holding and watchlist name (In uptrend, Dip in uptrend, Stretched, Downtrend, Short history) with R:R, from the engine own daily closes. A description of the chart, never a call to buy or sell.', props: { symbols: { type: 'array', items: { type: 'string' } } } },
  { name: 'closes_seed', handler: closesSeed, description: "Add daily closes for one symbol (from the broker's historical data) so its setup does not wait 50 refreshes. rows: [{ date: YYYY-MM-DD, close }].", props: { symbol: { type: 'string' }, rows: { type: 'array', items: { type: 'object', properties: { date: { type: 'string' }, close: { type: 'number' } } } } }, required: ['symbol', 'rows'] },
  { name: 'watchlist', handler: watchlistCmd, description: 'The investor watchlist and saved screens, kept in the profile. action: list, add, remove (symbol), save_screen (name, url or query), remove_screen (name), record_results (name, symbols: what the screen returned, run by the investor browser). Screen output, never recommendations. Lists each name with its setup.', props: { action: { type: 'string', enum: ['list', 'add', 'remove', 'save_screen', 'remove_screen', 'record_results'] }, symbol: { type: 'string' }, note: { type: 'string' }, source: { type: 'string' }, name: { type: 'string' }, url: { type: 'string' }, query: { type: 'string' }, symbols: { type: 'array', items: { type: 'string' } } } },
  { name: 'deploy', handler: deployCmd, description: 'Split broker cash by the global gap, the saved destination weights, index valuation (valuations: { SYMBOL: { pe, median_pe } }) and setup; metals in halves; returns the amount and destinations for draft_basket, plus optional dip limits with a deadline (proposals only). keep_cash stays untouched. Places nothing.', props: { cash: { type: 'number' }, keep_cash: { type: 'number' }, global_gap_inr: { type: 'number' }, destinations: { type: 'array', items: { type: 'object' } }, valuations: { type: 'object' }, stage_metals: { type: 'boolean' }, dip_days: { type: 'number' } } },
  { name: 'intraday_plan', handler: intradayPlan, description: 'Levels from 5-minute candles the caller read from the broker (t ISO time, o, h, l, c, v): opening range, VWAP, 20 EMA, a stop below structure, the quantity that makes a stop cost risk_inr, charges netted, net R:R. log: true with symbol saves the call for the retro. Not a prediction.', props: { symbol: { type: 'string' }, candles: { type: 'array', items: { type: 'object' } }, side: { type: 'string', enum: ['long', 'short'] }, risk_inr: { type: 'number' }, product: { type: 'string', enum: ['MIS', 'CNC'] }, entry: { type: 'number' }, target_r: { type: 'number' }, log: { type: 'boolean' } }, required: ['candles', 'risk_inr'] },
  { name: 'intraday_watch', handler: intradayWatch, description: "Today's logged intraday calls against the latest prices (prices: { SYMBOL: ltp }): open, stop hit or target hit. Call it every N minutes while the investor trades.", props: { prices: { type: 'object' } } },
  { name: 'retro', handler: retroCmd, description: "Replay a day's logged intraday calls against the candles that followed (candles: { SYMBOL: [5-minute candles] }): outcome and net after charges per call, with the total against the loss tolerance. date defaults to today.", props: { date: { type: 'string' }, candles: { type: 'object' } } },
  { name: 'close_session', handler: closeSession, description: 'End of session: append a dated summary (decisions, strategies, trades, tools: arrays of short lines) to the log and optionally rewrite the Start here block. Refuses when the folder has no profile.json (an uploaded copy or the wrong folder).', props: { decisions: { type: 'array', items: { type: 'string' } }, strategies: { type: 'array', items: { type: 'string' } }, trades: { type: 'array', items: { type: 'string' } }, tools: { type: 'array', items: { type: 'string' } }, start_here: { type: 'string' } } },
];

function listTools(edition) {
  return TOOLS.filter((t) => !(t.fullOnly && edition === 'lite')).map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: { type: 'object', properties: { ...FOLDER, ...t.props }, required: t.required || [] },
  }));
}

function makeContext(overrides = {}) {
  return { edition: process.env.PORTFOLIO_EDITION || (/-lite$/.test(version.manifest().name) ? 'lite' : 'full'), now: () => new Date(), github: { token: process.env.PORTFOLIO_COPILOT_GITHUB_TOKEN || process.env.GITHUB_TOKEN, repo: process.env.PORTFOLIO_COPILOT_GAP_REPO || gapLib.DEFAULT_REPO, fetch: globalThis.fetch }, ...overrides };
}

// Tools that need no "profile missing" warning: they manage the profile themselves or never read it.
// Every other tool computes from the profile, so it gets the warning (issues #28, #32).
const PROFILE_TOOLS = new Set(['profile_get', 'profile_update', 'report_gap', 'log_append', 'state_export', 'state_import', 'state_writeback', 'close_session']);
// Drafting on defaults produced wrong orders (issues #28, #32): these refuse without a real profile (FR-040).
const NEEDS_PROFILE = new Set(['draft_gtt_plan', 'draft_basket', 'draft_orders', 'review_start', 'task_done']);

async function callTool(name, args, ctx) {
  const t = TOOLS.find((x) => x.name === name && !(x.fullOnly && ctx.edition === 'lite'));
  if (!t) return { ok: false, error: `unknown tool ${name}`, text: `Unknown tool ${name}` };
  try {
    if (NEEDS_PROFILE.has(name) && !profiles.load(args && args.folder).exists) {
      return { ok: false, error: 'no profile', text: `Not drafted: no profile.json at ${profiles.profilePath(args && args.folder)}. Drafts need the investor's real profile (GTT policy, verdicts). Point --folder at the investor's folder, or attach profile.json.` };
    }
    const r = await t.handler(args || {}, ctx);
    if (PROFILE_TOOLS.has(name) || !r || typeof r.text !== 'string' || profiles.load(args && args.folder).exists) return r;
    const warn = `**No profile.json found (${profiles.profilePath(args && args.folder)}): using built-in defaults.** That means Kite only, no verdicts, no sector map (sector cap skipped), and ETFs known by name or ISIN only. GTT, allocation and sector findings below may be wrong. Point to the real investor folder before acting on them.`;
    return { ...r, profile_missing: true, text: `${warn}\n\n${r.text}` };
  } catch (e) {
    return { ok: false, error: e.message, text: `Error in ${name}: ${e.message}` };
  }
}

module.exports = { TOOLS, listTools, callTool, makeContext };
