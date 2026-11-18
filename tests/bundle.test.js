'use strict';
// Spec 002 US6 (T033): one state bundle the cloud chat and the computer share.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { tmpEnv, writeProfile } = require('./helpers');
const { callTool } = require('../core/tools');
const bundle = require('../core/lib/bundle');

const ctx = (iso = '2026-11-16T05:00:00Z') => ({ edition: 'full', now: () => new Date(iso) });
const state = (folder, ...p) => path.join(folder, 'portfolio-copilot', ...p);

function seed(folder, holdings = 3) {
  writeProfile(folder, { schema_version: 2, verdicts: { SBIN: { stance: 'hold', reason: 'x' } } });
  fs.mkdirSync(state(folder, 'snapshots'), { recursive: true });
  const rows = Array.from({ length: holdings }, (_, i) => ({ broker: 'kite', symbol: `SYM${i}`, exchange: 'NSE', isin: `INE${String(i).padStart(9, '0')}`, type: 'equity', qty: 10 + i, avg: 100.5, ltp: 120.25, value: 1202.5, pnl: 197.5, day_change: 1.2, currency: 'INR' }));
  for (const d of ['2026-11-13', '2026-11-14', '2026-11-15']) {
    fs.writeFileSync(state(folder, 'snapshots', `${d}.json`), JSON.stringify({ taken_at: `${d}T05:00:00Z`, brokers: { kite: { status: 'live', as_of: `${d}T05:00:00Z`, holdings: rows, gtts: [], orders: [], cash: 1000 } } }, null, 2));
  }
  fs.mkdirSync(state(folder, 'drafts'), { recursive: true });
  fs.writeFileSync(state(folder, 'drafts', 'DAAAA.json'), JSON.stringify({ code: 'DAAAA', status: 'approved', rows: [] }));
  fs.writeFileSync(state(folder, 'drafts', 'DAAAA.row0.used'), '');
  fs.writeFileSync(state(folder, 'drafts', 'DBBBB.json'), JSON.stringify({ code: 'DBBBB', status: 'executed', rows: [] }));
  fs.writeFileSync(state(folder, 'log.md'), '# Portfolio log\n\n## Start here\nnothing\n');
}

test('export then import restores the same files, with the last two snapshots and open drafts only', async () => {
  const { root, folder } = tmpEnv();
  seed(folder);
  const out = path.join(root, 'b.json');
  const e = await callTool('state_export', { folder, out }, ctx());
  assert.ok(e.ok, e.text);
  assert.deepStrictEqual(e.files.sort(), [
    'portfolio-copilot/drafts/DAAAA.json', 'portfolio-copilot/log.md',
    'portfolio-copilot/profile.json', 'portfolio-copilot/snapshots/2026-11-14.json', 'portfolio-copilot/snapshots/2026-11-15.json',
  ]);
  const into = path.join(root, 'scratch');
  const i = await callTool('state_import', { bundle: out, into }, ctx());
  assert.ok(i.ok, i.text);
  for (const p of e.files.filter((x) => !x.includes('/drafts/'))) assert.strictEqual(fs.readFileSync(path.join(into, p), 'utf8'), fs.readFileSync(path.join(folder, p), 'utf8'), p);
  // A draft travels as a draft: approvals and used rows stay on the machine where you clicked.
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(into, 'portfolio-copilot/drafts/DAAAA.json'), 'utf8')).status, 'draft');
});

test('a bundle path outside the state folder, or a file that does not match its manifest, is refused (security review)', () => {
  const { root, folder } = tmpEnv();
  seed(folder);
  const out = path.join(root, 'b.json');
  bundle.exportBundle(folder, out, new Date('2026-11-16T05:00:00Z'));
  const b = JSON.parse(fs.readFileSync(out, 'utf8'));
  const escape = '../../outside.txt';
  fs.writeFileSync(out, JSON.stringify({ ...b, files: { ...b.files, [escape]: 'x' }, manifest: { ...b.manifest, [escape]: bundle.sha('x') } }));
  assert.throws(() => bundle.importBundle(out, path.join(root, 'x')), /path refused/);
  fs.writeFileSync(out, JSON.stringify({ ...b, files: { ...b.files, 'portfolio-copilot/profile.json': '{"x":1}' } }));
  assert.throws(() => bundle.importBundle(out, path.join(root, 'y')), /does not match its manifest/);
  assert.ok(!fs.existsSync(path.join(root, 'outside.txt')));
});

test('a 100-holding bundle is under 150 KB', () => {
  const { root, folder } = tmpEnv();
  seed(folder, 100);
  const r = bundle.exportBundle(folder, path.join(root, 'b.json'), new Date('2026-11-16T05:00:00Z'));
  assert.ok(r.bytes < 150 * 1024, `${r.bytes} bytes`);
});

test('state_writeback lists only changed and new files, and never writes', async () => {
  const { root, folder } = tmpEnv();
  seed(folder);
  const out = path.join(root, 'b.json');
  bundle.exportBundle(folder, out, new Date('2026-11-16T05:00:00Z'));
  const into = path.join(root, 'scratch');
  bundle.importBundle(out, into);
  fs.appendFileSync(path.join(into, 'portfolio-copilot', 'log.md'), '\n## 2026-11-16 10:30 IST\nchecked\n');
  fs.writeFileSync(path.join(into, 'portfolio-copilot', 'drafts', 'DCCCC.json'), JSON.stringify({ code: 'DCCCC', status: 'draft', rows: [] }));
  const before = fs.readFileSync(path.join(folder, 'portfolio-copilot', 'log.md'), 'utf8');
  const r = await callTool('state_writeback', { folder: into, bundle: out }, ctx());
  assert.ok(r.ok, r.text);
  const files = r.next[0].files.map((f) => f.path).sort();
  assert.deepStrictEqual(files, ['portfolio-copilot/drafts/DCCCC.json', 'portfolio-copilot/log.md']);
  assert.strictEqual(r.next[0].op, 'writeback');
  assert.strictEqual(fs.readFileSync(path.join(folder, 'portfolio-copilot', 'log.md'), 'utf8'), before, 'the source is untouched');
  const log = r.next[0].files.find((f) => f.path.endsWith('log.md'));
  assert.match(Buffer.from(log.content_b64, 'base64').toString('utf8'), /checked/);
});

test('a source file changed since the bundle is a conflict and is not returned', async () => {
  const { root, folder } = tmpEnv();
  seed(folder);
  const out = path.join(root, 'b.json');
  bundle.exportBundle(folder, out, new Date('2026-11-16T05:00:00Z'));
  const into = path.join(root, 'scratch');
  bundle.importBundle(out, into);
  fs.appendFileSync(path.join(into, 'portfolio-copilot', 'log.md'), '\nmore\n');
  const r = await callTool('state_writeback', { folder: into, bundle: out, source_hashes: { 'portfolio-copilot/log.md': bundle.sha('changed on the PC') } }, ctx());
  assert.deepStrictEqual(r.conflicts, ['portfolio-copilot/log.md']);
  assert.deepStrictEqual(r.next, []);
  assert.match(r.text, /Conflicts/);
});

test('import refuses to overwrite newer copies unless forced', async () => {
  const { root, folder } = tmpEnv();
  seed(folder);
  const out = path.join(root, 'b.json');
  bundle.exportBundle(folder, out, new Date('2020-01-01T00:00:00Z'));
  fs.appendFileSync(state(folder, 'log.md'), 'newer\n');
  const r = await callTool('state_import', { bundle: out, into: folder }, ctx());
  assert.strictEqual(r.ok, false);
  assert.ok(r.newer.includes('portfolio-copilot/log.md'));
  assert.ok((await callTool('state_import', { bundle: out, into: folder, force: true }, ctx())).ok);
});
