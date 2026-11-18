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

// A staged copy (30-Oct) accepted writes and kept nothing. Simulate that on every platform: the
// write calls return normally and the files do not change. (A read-only file is not portable:
// on Linux the profile's write-then-rename still succeeds.)
async function withLostWrites(fn) {
  const saved = { writeFileSync: fs.writeFileSync, appendFileSync: fs.appendFileSync, renameSync: fs.renameSync };
  fs.writeFileSync = () => {};
  fs.appendFileSync = () => {};
  fs.renameSync = () => {};
  try { return await fn(); } finally { Object.assign(fs, saved); }
}

test('log_append, report_gap and profile_update return ok: false when a write does not stick', async () => {
  const { folder } = tmpEnv();
  writeProfile(folder, { schema_version: 2 });
  fs.writeFileSync(pc(folder, 'log.md'), '# Portfolio log\n\n## Start here\nx\n');
  const log = await withLostWrites(() => callTool('log_append', { folder, text: 'entry' }, ctx));
  assert.strictEqual(log.ok, false, log.text);
  assert.match(log.text, /did not stick/);
  const gap = await withLostWrites(() => callTool('report_gap', { folder, title: 't', missing: 'm' }, { ...ctx, github: {} }));
  assert.strictEqual(gap.ok, false, gap.text);
  const prof = await withLostWrites(() => callTool('profile_update', { folder, path: 'review.max_tasks', value: 4 }, ctx));
  assert.strictEqual(prof.ok, false, prof.text);
});

test('a write the system refuses also fails the command', async () => {
  const { folder } = tmpEnv();
  writeProfile(folder, { schema_version: 2 });
  fs.mkdirSync(pc(folder, 'log.md'), { recursive: true }); // a directory where the log file should be
  const log = await callTool('log_append', { folder, text: 'entry' }, ctx);
  assert.strictEqual(log.ok, false, log.text);
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
