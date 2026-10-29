'use strict';
// Gap reporting, protection inputs and verdict notes.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const { tmpEnv, fixture, writeProfile, ctxAt } = require('./helpers');
const { callTool } = require('../core/tools');
const profiles = require('../core/lib/profile');

const NOW = '2026-10-29T05:00:00Z';

function fakeGithub(open = []) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    calls.push({ url, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null });
    const made = (init.method || 'GET') === 'POST' && url.endsWith('/issues');
    if (made) return { ok: true, status: 200, json: async () => ({ number: 99, html_url: 'https://github.com/x/y/issues/99' }) };
    if (/\/issues\/\d+$/.test(url)) return { ok: true, status: 200, json: async () => ({ number: 99, state: 'open', html_url: 'https://github.com/x/y/issues/99' }) };
    return { ok: true, status: 200, json: async () => (init.method === 'POST' ? {} : open) };
  };
  return { calls, gh: { token: 't', repo: 'x/y', fetch } };
}

test('report_gap without a token logs to the feedback file only', async () => {
  const { folder } = tmpEnv();
  const ctx = { ...ctxAt(NOW), github: { token: undefined, repo: 'x/y', fetch: async () => { throw new Error('must not call'); } } };
  const r = await callTool('report_gap', { folder, title: 'No SIP endpoint', missing: 'SIP list', attempted: 'read SIPs' }, ctx);
  assert.ok(r.ok);
  assert.strictEqual(r.filed, null);
  assert.match(fs.readFileSync(r.logged, 'utf8'), /No SIP endpoint/);
  assert.match(r.text, /No GitHub token/);
});

test('report_gap files an issue labelled gap, or comments on an open duplicate', async () => {
  const { folder } = tmpEnv();
  const a = fakeGithub([]);
  const made = await callTool('report_gap', { folder, title: 'No SIP endpoint', missing: 'SIP list' }, { ...ctxAt(NOW), github: a.gh });
  assert.strictEqual(made.filed.action, 'created');
  assert.deepStrictEqual(a.calls[1].body.labels, ['gap']);
  const b = fakeGithub([{ number: 7, title: 'no sip endpoint', html_url: 'https://github.com/x/y/issues/7' }]);
  const dup = await callTool('report_gap', { folder: tmpEnv().folder, title: 'No SIP endpoint', missing: 'SIP list' }, { ...ctxAt(NOW), github: b.gh });
  assert.strictEqual(dup.filed.action, 'commented');
  assert.match(b.calls[1].url, /issues\/7\/comments$/);
});

test('report_gap falls back to the log when GitHub fails', async () => {
  const { folder } = tmpEnv();
  const gh = { token: 't', repo: 'x/y', fetch: async () => ({ ok: false, status: 401 }) };
  const r = await callTool('report_gap', { folder, title: 'T', missing: 'M' }, { ...ctxAt(NOW), github: gh });
  assert.ok(r.ok);
  assert.match(r.text, /GitHub filing failed \(GitHub 401/);
  assert.ok(fs.existsSync(r.logged));
});

test('protection_check measures the emergency fund and flags missing inputs', async () => {
  const { folder } = tmpEnv();
  const empty = await callTool('protection_check', { folder }, ctxAt(NOW));
  assert.match(empty.text, /not recorded/);
  const p = fixture('profile.json');
  p.protection = { term_cover_inr: 10000000, health_cover: 'none', emergency_fund_inr: 300000, monthly_expenses_inr: 100000 };
  p.sips = [{ fund: 'Fund A', amount_inr: 5000, action: 'redirect', redirect_to: 'Index B' }];
  writeProfile(folder, p);
  const r = await callTool('protection_check', { folder }, ctxAt(NOW));
  assert.strictEqual(r.months_of_expenses, 3);
  assert.match(r.text, /3\.0 months of expenses; target 6-12/);
  assert.match(r.text, /No health insurance/);
  assert.match(r.text, /redirect to Index B/);
});

test('profile rejects bad sips and protection values', () => {
  const p = profiles.merge(profiles.DEFAULTS, { sips: [{ fund: 'A', action: 'redirect' }, { amount_inr: 1 }], protection: { health_cover: 'maybe', emergency_fund_inr: -1 } });
  const errs = profiles.validate(p).join('|');
  assert.match(errs, /sips\[0\]\.redirect_to/);
  assert.match(errs, /sips\[1\]\.fund/);
  assert.match(errs, /protection\.health_cover/);
  assert.match(errs, /protection\.emergency_fund_inr/);
});

test('verdict_notes renders reasons, exit levels and stop decisions', async () => {
  const { folder } = tmpEnv();
  const p = fixture('profile.json');
  p.verdicts.SBIN.stop_review = { decision: 'keep', at: '2026-10-29', reason: 'weakening', review_by: '2026-11-10' };
  writeProfile(folder, p);
  const r = await callTool('verdict_notes', { folder }, ctxAt(NOW));
  assert.match(r.text, /- JIOFIN: EXIT, thesis broken; exit at 260/);
  assert.match(r.text, /- SBIN: ADD, core bank; stop kept \(2026-10-29, weakening, review by 2026-11-10\)/);
});

test('report_gap twice in a row comments on the first issue even if the GitHub list lags', async () => {
  const { folder } = tmpEnv();
  const a = fakeGithub([]); // the list never shows the new issue
  const first = await callTool('report_gap', { folder, title: 'Same gap', missing: 'M' }, { ...ctxAt(NOW), github: a.gh });
  const second = await callTool('report_gap', { folder, title: 'Same gap', missing: 'M' }, { ...ctxAt(NOW), github: a.gh });
  assert.strictEqual(first.filed.action, 'created');
  assert.strictEqual(second.filed.action, 'commented');
  assert.match(a.calls.at(-1).url, /issues\/99\/comments$/);
});

function flaky(statuses) {
  const calls = [];
  const sleeps = [];
  let t = 0;
  const gh = {
    token: 't', repo: 'x/y', sleep: async (ms) => { sleeps.push(ms); }, clock: () => t,
    fetch: async (url, init = {}) => {
      calls.push(url);
      const s = statuses.length > 1 ? statuses.shift() : statuses[0];
      if (s === 'throw') throw new Error('socket hang up');
      const made = (init.method || 'GET') === 'POST' && url.endsWith('/issues');
      return { ok: s === 200, status: s, json: async () => (made ? { number: 5, html_url: 'https://github.com/x/y/issues/5' } : []) };
    },
  };
  return { gh, calls, sleeps, advance: (ms) => { t += ms; } };
}

test('GitHub calls retry with exponential backoff, then succeed', async () => {
  const { folder } = tmpEnv();
  const f = flaky([503, 'throw', 200]);
  const r = await callTool('report_gap', { folder, title: 'Backoff', missing: 'M' }, { ...ctxAt(NOW), github: f.gh });
  assert.strictEqual(r.filed.action, 'created');
  assert.deepStrictEqual(f.sleeps, [500, 1000]);
});

test('circuit breaker: 3 retries then give up, then fail fast until the cooldown ends', async () => {
  const { folder } = tmpEnv();
  const f = flaky([503]);
  const r = await callTool('report_gap', { folder, title: 'Down', missing: 'M' }, { ...ctxAt(NOW), github: f.gh });
  assert.strictEqual(r.filed, null);
  assert.match(r.text, /gave up after 3 retries/);
  assert.strictEqual(f.calls.length, 4); // first try + 3 retries
  assert.deepStrictEqual(f.sleeps, [500, 1000, 2000]);
  assert.ok(fs.existsSync(r.logged), 'still logged locally');
  const again = await callTool('report_gap', { folder, title: 'Down', missing: 'M' }, { ...ctxAt(NOW), github: f.gh });
  assert.match(again.text, /circuit open/);
  assert.strictEqual(f.calls.length, 4, 'no network while the breaker is open');
  f.advance(61000);
  await callTool('report_gap', { folder, title: 'Down', missing: 'M' }, { ...ctxAt(NOW), github: f.gh });
  assert.ok(f.calls.length > 4, 'tries again after the cooldown');
});

test('a 4xx such as 401 is not retried', async () => {
  const { folder } = tmpEnv();
  const f = flaky([401]);
  const r = await callTool('report_gap', { folder, title: 'Auth', missing: 'M' }, { ...ctxAt(NOW), github: f.gh });
  assert.match(r.text, /GitHub 401/);
  assert.strictEqual(f.calls.length, 1);
  assert.deepStrictEqual(f.sleeps, []);
});
