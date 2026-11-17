'use strict';
// Spec 002 T006: profile schema v2 (data-model section 1). A v1 profile loads with v2 defaults;
// each new rule rejects a bad value with a message naming the field.
const test = require('node:test');
const assert = require('node:assert');
const { tmpEnv, fixture, writeProfile } = require('./helpers');
const P = require('../core/lib/profile');

const v2 = (over) => P.merge(P.DEFAULTS, over);
const errs = (over) => P.validate(v2(over));
const rejects = (over, field) => {
  const e = errs(over);
  assert.ok(e.some((m) => m.startsWith(field)), `expected an error on ${field}, got ${JSON.stringify(e)}`);
};
const LOCK = { enabled: true, scope: 'play', arm_gain_pct: 20, book_gain_pct: 40, book_fraction_pct: 50, trail_pct: 10, reentry_cooloff_days: 30, proceeds_to: null };

test('a v1 profile loads as v2 with every v1 value kept and the new defaults filled in', () => {
  const { folder } = tmpEnv();
  const v1 = fixture('profile.json');
  writeProfile(folder, v1);
  const { profile, errors } = P.load(folder);
  assert.deepStrictEqual(errors, []);
  assert.strictEqual(profile.schema_version, 2);
  assert.deepStrictEqual(profile.limits, { single_stock_pct: 15, sector_pct: 30, fund_house_pct: 25, ...v1.limits, sector_base: 'direct_equity' });
  assert.deepStrictEqual(profile.verdicts, Object.fromEntries(Object.entries(v1.verdicts).map(([k, v]) => [k.toUpperCase(), v])));
  assert.deepStrictEqual(profile.deployment_plan, P.merge(P.DEFAULTS.deployment_plan, v1.deployment_plan));
  assert.strictEqual(profile.gtt_policy.crash_floor_pct, 25);
  assert.strictEqual(profile.gtt_policy.profit_lock.enabled, false);
  assert.strictEqual(profile.gtt_policy.profit_lock.arm_gain_pct, null);
  assert.deepStrictEqual(profile.classes, {});
  assert.deepStrictEqual(profile.reentry, []);
  assert.strictEqual(profile.loss_tolerance.measure, null);
  assert.strictEqual(profile.tax.fy_start_month, 4);
  assert.strictEqual(profile.log.path, null);
  assert.deepStrictEqual(profile.review, { max_tasks: 5, readback_after_days: 28 });
});

test('the next profile_update saves the file as v2', () => {
  const { folder } = tmpEnv();
  writeProfile(folder, fixture('profile.json'));
  assert.ok(P.update(folder, 'review.max_tasks', 4).ok);
  const raw = JSON.parse(require('fs').readFileSync(P.profilePath(folder), 'utf8'));
  assert.strictEqual(raw.schema_version, 2);
});

test('the v2 defaults validate clean', () => {
  assert.deepStrictEqual(errs({}), []);
});

test('classes are core or play', () => {
  rejects({ classes: { ALPHA: 'swing' } }, 'classes.ALPHA');
  assert.deepStrictEqual(errs({ classes: { ALPHA: 'play', GAMMAETF: 'core' } }), []);
});

test('limits.sector_base is direct_equity, kite_listed or book', () => {
  rejects({ limits: { sector_base: 'everything' } }, 'limits.sector_base');
  for (const b of ['direct_equity', 'kite_listed', 'book']) assert.deepStrictEqual(errs({ limits: { sector_base: b } }), []);
});

test('allocation bands are a number above 0 or null', () => {
  rejects({ allocation: { bands_pp: { india_equity: 0 } } }, 'allocation.bands_pp.india_equity');
  rejects({ allocation: { bands_pp: { gold: 'wide' } } }, 'allocation.bands_pp.gold');
  assert.deepStrictEqual(errs({ allocation: { bands_pp: { india_equity: 5, global_equity: null } } }), []);
});

test('profit lock can be enabled only with all five numbers set', () => {
  assert.deepStrictEqual(errs({ gtt_policy: { profit_lock: LOCK } }), []);
  for (const k of ['arm_gain_pct', 'book_gain_pct', 'book_fraction_pct', 'trail_pct', 'reentry_cooloff_days']) {
    rejects({ gtt_policy: { profit_lock: { ...LOCK, [k]: null } } }, `gtt_policy.profit_lock.${k}`);
  }
});

test('profit lock numbers keep their order and range, and scope is play or all_stocks', () => {
  rejects({ gtt_policy: { profit_lock: { ...LOCK, arm_gain_pct: 50 } } }, 'gtt_policy.profit_lock.arm_gain_pct');
  rejects({ gtt_policy: { profit_lock: { ...LOCK, arm_gain_pct: 0 } } }, 'gtt_policy.profit_lock.arm_gain_pct');
  rejects({ gtt_policy: { profit_lock: { ...LOCK, book_fraction_pct: 100 } } }, 'gtt_policy.profit_lock.book_fraction_pct');
  rejects({ gtt_policy: { profit_lock: { ...LOCK, trail_pct: 0 } } }, 'gtt_policy.profit_lock.trail_pct');
  rejects({ gtt_policy: { profit_lock: { ...LOCK, scope: 'everything' } } }, 'gtt_policy.profit_lock.scope');
  assert.deepStrictEqual(errs({ gtt_policy: { profit_lock: { ...LOCK, scope: 'all_stocks' } } }), []);
});

const verdict = (tripwires, on) => ({ verdicts: { ALPHA: { stance: 'hold_no_add', reason: 'x', tripwires, on_tripwire: on } } });

test('tripwires use a known metric, exactly one of below or above, and for_quarters >= 1', () => {
  assert.deepStrictEqual(errs(verdict([{ id: 'm', metric: 'ebitda_margin_pct', below: 20, for_quarters: 2 }, { id: 'g', metric: 'sales_growth_yoy_pct', below: 0 }], 'exit')), []);
  rejects(verdict([{ id: 'x', metric: 'vibes_pct', below: 1 }], 'exit'), 'verdicts.ALPHA.tripwires[0].metric');
  rejects(verdict([{ id: 'x', metric: 'pe', below: 1, above: 50 }], 'exit'), 'verdicts.ALPHA.tripwires[0]');
  rejects(verdict([{ id: 'x', metric: 'pe' }], 'exit'), 'verdicts.ALPHA.tripwires[0]');
  rejects(verdict([{ id: 'x', metric: 'pe', above: 50, for_quarters: 0 }], 'exit'), 'verdicts.ALPHA.tripwires[0].for_quarters');
  rejects(verdict([{ id: 'x', metric: 'pe', above: 50, for_quarters: 1.5 }], 'exit'), 'verdicts.ALPHA.tripwires[0].for_quarters');
});

test('on_tripwire is exit, reduce or review', () => {
  rejects(verdict([], 'panic'), 'verdicts.ALPHA.on_tripwire');
  for (const on of ['exit', 'reduce', 'review']) assert.deepStrictEqual(errs(verdict([], on)), []);
});

test('loss_tolerance.measure is realised, realised_plus_open or null', () => {
  rejects({ loss_tolerance: { measure: 'paper' } }, 'loss_tolerance.measure');
  for (const m of ['realised', 'realised_plus_open', null]) assert.deepStrictEqual(errs({ loss_tolerance: { measure: m } }), []);
});

test('tax values need tax.as_of once any is set', () => {
  rejects({ tax: { ltcg_pct: 12.5 } }, 'tax.as_of');
  assert.deepStrictEqual(errs({ tax: { ltcg_pct: 12.5, as_of: '2026-11-17' } }), []);
});

test('log.path is a file name inside the investor folder, or null', () => {
  rejects({ log: { path: '../elsewhere.md' } }, 'log.path');
  rejects({ log: { path: 'C:\\notes\\log.md' } }, 'log.path');
  rejects({ log: { path: 'sub/log.md' } }, 'log.path');
  assert.deepStrictEqual(errs({ log: { path: 'journal.md' } }), []);
});
