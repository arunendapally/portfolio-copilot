'use strict';
// Spec 002 US6 (T034): a failed write fails the command (FR-039); the log can be the investor's
// own file (FR-041).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { tmpEnv, writeProfile } = require('./helpers');
const { callTool } = require('../core/tools');

const ctx = { edition: 'full', now: () => new Date('2026-11-16T05:00:00Z') };
const pc = (folder, ...p) => path.join(folder, 'portfolio-copilot', ...p);

function readOnly(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  fs.chmodSync(file, 0o444);
}

test('log_append, report_gap and profile_update return ok: false on a read-only target', async () => {
  const { folder } = tmpEnv();
  writeProfile(folder, { schema_version: 2 });
  readOnly(pc(folder, 'log.md'), '# Portfolio log\n\n## Start here\nx\n');
  const log = await callTool('log_append', { folder, text: 'entry' }, ctx);
  assert.strictEqual(log.ok, false, log.text);
  readOnly(pc(folder, 'feedback.md'), '# Feedback log\n');
  const gap = await callTool('report_gap', { folder, title: 't', missing: 'm' }, { ...ctx, github: {} });
  assert.strictEqual(gap.ok, false, gap.text);
  fs.chmodSync(pc(folder, 'profile.json'), 0o444);
  const prof = await callTool('profile_update', { folder, path: 'review.max_tasks', value: 4 }, ctx);
  assert.strictEqual(prof.ok, false, prof.text);
});

test('log_append writes to profile.log.path when set, append-only', async () => {
  const { folder } = tmpEnv();
  writeProfile(folder, { schema_version: 2, log: { path: 'journal.md' } });
  fs.writeFileSync(path.join(folder, 'journal.md'), '# My own notes\nkeep this\n');
  const r = await callTool('log_append', { folder, text: 'checked the book' }, ctx);
  assert.ok(r.ok, r.text);
  const t = fs.readFileSync(path.join(folder, 'journal.md'), 'utf8');
  assert.match(t, /^# My own notes\nkeep this\n/);
  assert.match(t, /## 2026-11-16 10:30 IST\nchecked the book/);
  assert.ok(!fs.existsSync(pc(folder, 'log.md')));
});
