'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { tmpEnv } = require('./helpers');
const fmt = require('../core/lib/format');
const state = require('../core/lib/state');
const profiles = require('../core/lib/profile');
const log = require('../core/lib/log');

test('inr uses Indian digit grouping', () => {
  assert.strictEqual(fmt.inr(1234567), '₹12,34,567');
  assert.strictEqual(fmt.inr(-950), '-₹950');
  assert.strictEqual(fmt.inr(null), 'n/a');
});

test('istStamp converts UTC to IST', () => {
  assert.strictEqual(fmt.istStamp(new Date('2026-10-14T09:00:00Z')), '2026-10-14 14:30 IST');
  assert.strictEqual(fmt.istDate(new Date('2026-10-14T20:00:00Z')), '2026-10-15');
});

test('profile defaults fill missing keys and validation names the path', () => {
  const { folder } = tmpEnv();
  const { profile, exists, errors } = profiles.load(folder);
  assert.strictEqual(exists, false);
  assert.strictEqual(profile.gtt_policy.crash_floor_pct, 25);
  assert.deepStrictEqual(errors, []);
  const bad = profiles.update(folder, 'cash.buffer_location', 'mattress');
  assert.strictEqual(bad.ok, false);
  assert.match(bad.errors[0], /cash\.buffer_location/);
  assert.ok(profiles.update(folder, 'cash.buffer_location', 'bank').ok);
  assert.strictEqual(profiles.load(folder).profile.cash.buffer_location, 'bank');
});

test('profile rejects destinations that do not sum to 100', () => {
  const { folder } = tmpEnv();
  const r = profiles.update(folder, 'deployment_plan.destinations', [{ symbol: 'A', weight_pct: 50 }]);
  assert.strictEqual(r.ok, false);
  assert.match(r.errors.join(), /sum to 50/);
});

test('verdictOf defaults to hold', () => {
  const v = profiles.verdictOf(profiles.DEFAULTS, 'xyz');
  assert.strictEqual(v.stance, 'hold');
  assert.ok(v.implicit);
});

test('snapshots keep the last 30', () => {
  const { folder } = tmpEnv();
  for (let i = 0; i < 35; i++) {
    const d = new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10);
    state.saveSnapshot(folder, d, { taken_at: '', brokers: {} });
  }
  const left = state.listSnapshots(folder);
  assert.strictEqual(left.length, 30);
  assert.strictEqual(left[0], '2026-01-06.json');
});

test('session store lives outside the working folder', () => {
  const { folder } = tmpEnv();
  state.updateSession('kite', { mcp_session_id: 'abc' });
  assert.ok(!fs.existsSync(path.join(folder, 'portfolio-copilot', 'sessions.json')));
  assert.strictEqual(state.loadSessions().kite.mcp_session_id, 'abc');
});

test('folder passed once is remembered', () => {
  const { folder } = tmpEnv();
  state.resolveFolder(folder);
  assert.strictEqual(state.resolveFolder(), path.resolve(folder));
});

test('log keeps only this month and archives older months', () => {
  const { folder } = tmpEnv();
  log.append(folder, { text: 'september note', startHere: 'goal: test' }, new Date('2026-09-30T05:00:00Z'));
  const r = log.append(folder, { text: 'october note' }, new Date('2026-10-02T05:00:00Z'));
  assert.deepStrictEqual(r.archived, ['2026-09']);
  const body = fs.readFileSync(r.path, 'utf8');
  assert.match(body, /## Start here\ngoal: test/);
  assert.match(body, /october note/);
  assert.doesNotMatch(body, /september note/);
  assert.match(fs.readFileSync(path.join(folder, 'portfolio-copilot', 'log', '2026-09.md'), 'utf8'), /september note/);
});
