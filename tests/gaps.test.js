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
    return { ok: true, status: 200, json: async () => (made ? { html_url: 'https://github.com/x/y/issues/99' } : (init.method === 'POST' ? {} : open)) };
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
  const dup = await callTool('report_gap', { folder, title: 'No SIP endpoint', missing: 'SIP list' }, { ...ctxAt(NOW), github: b.gh });
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
