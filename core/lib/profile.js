'use strict';
// Investor profile: defaults, load (defaults filled in), validation, path updates.

const path = require('path');
const { stateDir, readJson, writeJson } = require('./state');

// 'trade': a deliberate short-term position with its own stop/target; the crash-floor rule does not apply (issue #7).
const STANCES = ['hold', 'add', 'hold_no_add', 'reduce', 'exit', 'trade'];
const STOP_DECISIONS = ['keep', 'widen'];
const SIP_ACTIONS = ['continue', 'stop', 'redirect'];
const HEALTH_COVER = ['unknown', 'none', 'employer', 'personal', 'both'];
// Schema v2 (spec 002, data-model section 1).
const CLASSES = ['core', 'play'];
const SECTOR_BASES = ['direct_equity', 'kite_listed', 'book'];
const LOCK_SCOPES = ['play', 'all_stocks'];
const LOCK_NUMBERS = ['arm_gain_pct', 'book_gain_pct', 'book_fraction_pct', 'trail_pct', 'reentry_cooloff_days'];
const ON_TRIPWIRE = ['exit', 'reduce', 'review'];
const LOSS_MEASURES = ['realised', 'realised_plus_open'];
// Tripwire and research_submit metrics (contracts/pc-commands.md). Adding one is a code change with a test.
const METRICS = [
  'sales_growth_yoy_pct', 'profit_growth_yoy_pct', 'ebitda_margin_pct', 'opm_pct',
  'gnpa_pct', 'nnpa_pct', 'slippage_pct', 'credit_cost_pct',
  'roa_pct', 'roe_pct', 'nim_pct', 'cost_of_borrowing_pct', 'debt_to_equity', 'pe',
  'flag_guidance_cut', 'flag_regulatory_escalation', 'flag_auditor_qualification', 'flag_results_delayed',
];

const DEFAULTS = Object.freeze({
  schema_version: 2,
  investor: { goal: '', horizon_years: null, risk: 'balanced', return_target_pct: 10 },
  brokers: { kite: { enabled: true }, kotak: { enabled: false, ucc: '' }, ibkr: { enabled: false } },
  cash: { buffer_min_pct: 5, buffer_max_pct: 10, buffer_location: 'broker' },
  limits: { single_stock_pct: 15, sector_pct: 30, fund_house_pct: 25, sector_base: 'direct_equity' },
  allocation: { targets: {}, symbol_buckets: {}, bands_pp: {} },
  gtt_policy: {
    etf_stop: false,
    crash_floor_pct: 25,
    min_stop_distance_pct: 20,
    crash_test_pcts: [10, 20],
    exit_verdict_stop: false,
    etf_symbols: [],
    profit_lock: {
      enabled: false, scope: 'play',
      arm_gain_pct: null, book_gain_pct: null, book_fraction_pct: null,
      trail_pct: null, reentry_cooloff_days: null, proceeds_to: null,
    },
  },
  verdicts: {},
  sectors: {},
  rate_overrides: {},
  sips: [],
  protection: { term_cover_inr: null, health_cover: 'unknown', emergency_fund_inr: null, monthly_expenses_inr: null },
  // corpus_source: text matched against holding symbols and fund names (e.g. "ARBITRAGE") to read the corpus live.
  deployment_plan: { index: 'NIFTY 50', corpus_inr: null, corpus_source: null, stages: [], destinations: [] },
  classes: {},
  plan: { start: null, start_book_inr: null, return_pct: null, monthly: [], step_up_pct: null, step_up_month: null, behind_tolerance_pct: null },
  reentry: [],
  loss_tolerance: { amount_inr: null, from: null, to: null, measure: null },
  tax: { as_of: null, ltcg_exemption_inr: null, ltcg_pct: null, stcg_pct: null, fy_start_month: 4 },
  valuation_overrides: {},
  log: { path: null },
  review: { max_tasks: 5, readback_after_days: 28 },
});

function isObj(v) {
  return v && typeof v === 'object' && !Array.isArray(v);
}

function merge(base, over) {
  if (!isObj(base) || !isObj(over)) return over === undefined ? clone(base) : clone(over);
  const out = clone(base);
  for (const [k, v] of Object.entries(over)) out[k] = k in base ? merge(base[k], v) : clone(v);
  return out;
}

function clone(v) {
  return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
}

function profilePath(folder) {
  return path.join(stateDir(folder), 'profile.json');
}

function validate(p) {
  const errs = [];
  const num = (v, at, min = -Infinity, max = Infinity) => {
    if (v === null) return;
    if (typeof v !== 'number' || Number.isNaN(v) || v < min || v > max) errs.push(`${at}: expected number in [${min}, ${max}]`);
  };
  if (!['conservative', 'balanced', 'aggressive'].includes(p.investor.risk)) errs.push('investor.risk: conservative | balanced | aggressive');
  if (!['broker', 'bank'].includes(p.cash.buffer_location)) errs.push('cash.buffer_location: broker | bank');
  num(p.cash.buffer_min_pct, 'cash.buffer_min_pct', 0, 100);
  num(p.cash.buffer_max_pct, 'cash.buffer_max_pct', 0, 100);
  for (const k of ['single_stock_pct', 'sector_pct', 'fund_house_pct']) num(p.limits[k], `limits.${k}`, 0, 100);
  const g = p.gtt_policy;
  num(g.crash_floor_pct, 'gtt_policy.crash_floor_pct', 1, 90);
  num(g.min_stop_distance_pct, 'gtt_policy.min_stop_distance_pct', 0, 90);
  if (!Array.isArray(g.crash_test_pcts) || g.crash_test_pcts.some((x) => typeof x !== 'number')) errs.push('gtt_policy.crash_test_pcts: array of numbers');
  if (!Array.isArray(g.etf_symbols)) errs.push('gtt_policy.etf_symbols: array');
  for (const [sym, v] of Object.entries(p.verdicts)) {
    if (!isObj(v) || !STANCES.includes(v.stance)) errs.push(`verdicts.${sym}.stance: ${STANCES.join(' | ')}`);
    if (isObj(v)) validateTripwires(v, `verdicts.${sym}`, errs);
    else if (v.exit_level !== undefined && v.exit_level !== null) num(v.exit_level, `verdicts.${sym}.exit_level`, 0);
    if (isObj(v) && v.stop_review !== undefined && v.stop_review !== null) {
      const r = v.stop_review;
      if (!isObj(r) || !STOP_DECISIONS.includes(r.decision)) errs.push(`verdicts.${sym}.stop_review.decision: ${STOP_DECISIONS.join(' | ')}`);
      else for (const k of ['at', 'review_by']) if (r[k] !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(r[k])) errs.push(`verdicts.${sym}.stop_review.${k}: YYYY-MM-DD`);
    }
  }
  for (const [sym, v] of Object.entries(p.rate_overrides)) {
    if (!['most', 'mixed', 'least'].includes(v)) errs.push(`rate_overrides.${sym}: most | mixed | least`);
  }
  if (!Array.isArray(p.sips)) errs.push('sips: array');
  else {
    p.sips.forEach((s, i) => {
      if (!isObj(s) || !s.fund) errs.push(`sips[${i}].fund: required`);
      else {
        num(s.amount_inr === undefined ? null : s.amount_inr, `sips[${i}].amount_inr`, 0);
        if (s.action !== undefined && !SIP_ACTIONS.includes(s.action)) errs.push(`sips[${i}].action: ${SIP_ACTIONS.join(' | ')}`);
        if (s.action === 'redirect' && !s.redirect_to) errs.push(`sips[${i}].redirect_to: required when action is redirect`);
      }
    });
  }
  const pr = p.protection;
  if (!HEALTH_COVER.includes(pr.health_cover)) errs.push(`protection.health_cover: ${HEALTH_COVER.join(' | ')}`);
  for (const k of ['term_cover_inr', 'emergency_fund_inr', 'monthly_expenses_inr']) num(pr[k], `protection.${k}`, 0);
  const d = p.deployment_plan;
  if (!Array.isArray(d.stages)) errs.push('deployment_plan.stages: array');
  else d.stages.forEach((s, i) => {
    num(s.level, `deployment_plan.stages[${i}].level`, 0);
    num(s.share_pct, `deployment_plan.stages[${i}].share_pct`, 0, 100);
    if (s.done_at !== undefined && s.done_at !== null && Number.isNaN(Date.parse(s.done_at))) errs.push(`deployment_plan.stages[${i}].done_at: a date (YYYY-MM-DD) or null`);
  });
  if (d.corpus_source !== null && d.corpus_source !== undefined && typeof d.corpus_source !== 'string') errs.push('deployment_plan.corpus_source: text or null');
  if (!Array.isArray(d.destinations)) errs.push('deployment_plan.destinations: array');
  else {
    d.destinations.forEach((x, i) => { if (!x.symbol) errs.push(`deployment_plan.destinations[${i}].symbol: required`); num(x.weight_pct, `deployment_plan.destinations[${i}].weight_pct`, 0, 100); });
    const sum = d.destinations.reduce((a, x) => a + (x.weight_pct || 0), 0);
    if (d.destinations.length && Math.abs(sum - 100) > 0.01) errs.push(`deployment_plan.destinations: weights sum to ${sum}, expected 100`);
  }
  validateV2(p, errs, num);
  return errs;
}

function validateTripwires(v, at, errs) {
  if (v.on_tripwire !== undefined && v.on_tripwire !== null && !ON_TRIPWIRE.includes(v.on_tripwire)) errs.push(`${at}.on_tripwire: ${ON_TRIPWIRE.join(' | ')}`);
  if (v.tripwires === undefined) return;
  if (!Array.isArray(v.tripwires)) return errs.push(`${at}.tripwires: array`);
  v.tripwires.forEach((t, i) => {
    const w = `${at}.tripwires[${i}]`;
    if (!isObj(t)) return errs.push(`${w}: object`);
    if (!METRICS.includes(t.metric)) errs.push(`${w}.metric: one of ${METRICS.join(', ')}`);
    const sides = ['below', 'above'].filter((k) => t[k] !== undefined && t[k] !== null);
    if (sides.length !== 1) errs.push(`${w}: exactly one of below / above`);
    else if (typeof t[sides[0]] !== 'number' || Number.isNaN(t[sides[0]])) errs.push(`${w}.${sides[0]}: number`);
    if (t.for_quarters !== undefined && !(Number.isInteger(t.for_quarters) && t.for_quarters >= 1)) errs.push(`${w}.for_quarters: integer >= 1`);
  });
}

function validateV2(p, errs, num) {
  for (const [sym, c] of Object.entries(p.classes || {})) if (!CLASSES.includes(c)) errs.push(`classes.${sym}: ${CLASSES.join(' | ')}`);
  if (!SECTOR_BASES.includes(p.limits.sector_base)) errs.push(`limits.sector_base: ${SECTOR_BASES.join(' | ')}`);
  for (const [b, v] of Object.entries(p.allocation.bands_pp || {})) {
    if (v !== null && !(typeof v === 'number' && v > 0)) errs.push(`allocation.bands_pp.${b}: number > 0 or null`);
  }
  const l = p.gtt_policy.profit_lock;
  const at = 'gtt_policy.profit_lock';
  if (!LOCK_SCOPES.includes(l.scope)) errs.push(`${at}.scope: ${LOCK_SCOPES.join(' | ')}`);
  for (const k of LOCK_NUMBERS) {
    if (l[k] === null) { if (l.enabled === true) errs.push(`${at}.${k}: required when enabled`); }
    else num(l[k], `${at}.${k}`, 0);
  }
  const set = (k) => typeof l[k] === 'number';
  if (set('arm_gain_pct') && !(l.arm_gain_pct > 0 && (!set('book_gain_pct') || l.arm_gain_pct < l.book_gain_pct))) errs.push(`${at}.arm_gain_pct: 0 < arm_gain_pct < book_gain_pct`);
  if (set('book_fraction_pct') && !(l.book_fraction_pct > 0 && l.book_fraction_pct < 100)) errs.push(`${at}.book_fraction_pct: 0 < book_fraction_pct < 100`);
  if (set('trail_pct') && !(l.trail_pct > 0)) errs.push(`${at}.trail_pct: > 0`);
  const m = p.loss_tolerance.measure;
  if (m !== null && !LOSS_MEASURES.includes(m)) errs.push(`loss_tolerance.measure: ${LOSS_MEASURES.join(' | ')} | null`);
  const t = p.tax;
  if (['ltcg_exemption_inr', 'ltcg_pct', 'stcg_pct'].some((k) => t[k] !== null) && !t.as_of) errs.push('tax.as_of: required once any tax value is set');
  const lp = p.log.path;
  if (lp !== null && (typeof lp !== 'string' || !lp || /[\\/:]/.test(lp) || lp === '.' || lp === '..')) errs.push('log.path: a file name inside the investor folder, or null');
}

function load(folder) {
  const raw = readJson(profilePath(folder), null);
  const profile = merge(DEFAULTS, raw || {});
  // Migration (v1 -> v2): defaults fill the new fields; the file is saved as v2 on the next update.
  profile.schema_version = DEFAULTS.schema_version;
  // Normalize verdict keys to upper-case symbols.
  profile.verdicts = Object.fromEntries(Object.entries(profile.verdicts).map(([k, v]) => [k.toUpperCase(), v]));
  return { profile, exists: !!raw, errors: validate(profile) };
}

function verdictOf(profile, symbol) {
  return profile.verdicts[symbol.toUpperCase()] || { stance: 'hold', reason: 'no verdict: default hold', implicit: true };
}

function setPath(obj, dotted, value) {
  const keys = dotted.split('.');
  let cur = obj;
  for (const k of keys.slice(0, -1)) {
    if (!isObj(cur[k])) cur[k] = {};
    cur = cur[k];
  }
  if (value === null && isObj(cur) && keys[keys.length - 1] in cur && dotted.startsWith('verdicts.')) delete cur[keys[keys.length - 1]];
  else cur[keys[keys.length - 1]] = value;
}

function getPath(obj, dotted) {
  if (!dotted) return obj;
  return dotted.split('.').reduce((o, k) => (o === undefined || o === null ? undefined : o[k]), obj);
}

function update(folder, dotted, value) {
  const raw = readJson(profilePath(folder), null) || clone(DEFAULTS);
  const next = clone(raw);
  next.schema_version = DEFAULTS.schema_version;
  setPath(next, dotted, value);
  const errors = validate(merge(DEFAULTS, next));
  if (errors.length) return { ok: false, errors };
  writeJson(profilePath(folder), next);
  if (JSON.stringify(readJson(profilePath(folder), null)) !== JSON.stringify(next)) throw new Error(`profile write to ${profilePath(folder)} did not stick`);
  return { ok: true, value: getPath(next, dotted) };
}

module.exports = { DEFAULTS, STANCES, METRICS, load, update, validate, verdictOf, getPath, merge, profilePath };
