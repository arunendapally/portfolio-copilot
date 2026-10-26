'use strict';
// Investor profile: defaults, load (defaults filled in), validation, path updates.

const path = require('path');
const { stateDir, readJson, writeJson } = require('./state');

// 'trade': a deliberate short-term position with its own stop/target; the crash-floor rule does not apply (issue #7).
const STANCES = ['hold', 'add', 'hold_no_add', 'reduce', 'exit', 'trade'];

const DEFAULTS = Object.freeze({
  schema_version: 1,
  investor: { goal: '', horizon_years: null, risk: 'balanced', return_target_pct: 10 },
  brokers: { kite: { enabled: true }, kotak: { enabled: false, ucc: '' }, ibkr: { enabled: false } },
  cash: { buffer_min_pct: 5, buffer_max_pct: 10, buffer_location: 'broker' },
  limits: { single_stock_pct: 15, sector_pct: 30, fund_house_pct: 25 },
  allocation: { targets: {}, symbol_buckets: {} },
  gtt_policy: {
    etf_stop: false,
    crash_floor_pct: 25,
    min_stop_distance_pct: 20,
    crash_test_pcts: [10, 20],
    exit_verdict_stop: false,
    etf_symbols: [],
  },
  verdicts: {},
  sectors: {},
  rate_overrides: {},
  // corpus_source: text matched against holding symbols and fund names (e.g. "ARBITRAGE") to read the corpus live.
  deployment_plan: { index: 'NIFTY 50', corpus_inr: null, corpus_source: null, stages: [], destinations: [] },
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
    else if (v.exit_level !== undefined && v.exit_level !== null) num(v.exit_level, `verdicts.${sym}.exit_level`, 0);
  }
  for (const [sym, v] of Object.entries(p.rate_overrides)) {
    if (!['most', 'mixed', 'least'].includes(v)) errs.push(`rate_overrides.${sym}: most | mixed | least`);
  }
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
  return errs;
}

function load(folder) {
  const raw = readJson(profilePath(folder), null);
  const profile = merge(DEFAULTS, raw || {});
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
  setPath(next, dotted, value);
  const errors = validate(merge(DEFAULTS, next));
  if (errors.length) return { ok: false, errors };
  writeJson(profilePath(folder), next);
  return { ok: true, value: getPath(next, dotted) };
}

module.exports = { DEFAULTS, STANCES, load, update, validate, verdictOf, getPath, merge, profilePath };
