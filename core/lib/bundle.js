'use strict';
// State bundle (spec 002 US6, data-model section 8): the investor's state as one JSON file, so a
// cloud chat and the computer work on the same files and never drift silently.
// The log goes in whole (it holds only the current month), so writing it back loses nothing.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { resolveFolder, STATE_DIRNAME, listSnapshots } = require('./state');

const SCHEMA = 1;
const JOURNAL_LINES = 200;

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const rel = (...p) => [STATE_DIRNAME, ...p].join('/');

function readText(root, file) {
  try { return fs.readFileSync(path.join(root, file), 'utf8'); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
}

function list(root, dir) {
  try { return fs.readdirSync(path.join(root, dir)); } catch (e) { if (e.code === 'ENOENT') return []; throw e; }
}

// The bundled files of a folder: path (relative to the investor folder, forward slashes) -> text.
function collect(folder, today) {
  const root = resolveFolder(folder);
  const files = {};
  const add = (p, transform) => { const t = readText(root, p); if (t !== null) files[p] = transform ? transform(t) : t; };
  add(rel('profile.json'));
  for (const s of listSnapshots(folder).slice(-2)) add(rel('snapshots', s));
  for (const f of list(root, rel('drafts'))) {
    if (!f.endsWith('.json')) continue;
    let d = null;
    try { d = JSON.parse(readText(root, rel('drafts', f))); } catch { continue; }
    if (!d || !['draft', 'approved'].includes(d.status)) continue;
    add(rel('drafts', f));
    const code = f.slice(0, -5);
    for (const m of list(root, rel('drafts'))) if (m.startsWith(`${code}.row`) && m.endsWith('.used')) add(rel('drafts', m));
  }
  for (const f of list(root, rel('runs'))) if (today && f.startsWith(today)) add(rel('runs', f));
  add(rel('marks.json'));
  add(rel('journal.jsonl'), (t) => t.split(/\r?\n/).filter(Boolean).slice(-JOURNAL_LINES).join('\n') + '\n');
  add(rel('log.md'));
  return files;
}

function exportBundle(folder, out, now, source = 'pc') {
  const files = collect(folder, now.toISOString().slice(0, 10));
  const manifest = Object.fromEntries(Object.entries(files).map(([p, t]) => [p, sha(t)]));
  const bundle = { schema_version: SCHEMA, exported_at: now.toISOString(), source, manifest, files };
  const text = JSON.stringify(bundle);
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(out, text);
  if (fs.readFileSync(out, 'utf8') !== text) throw new Error(`bundle write to ${out} did not stick`);
  return { path: path.resolve(out), bytes: Buffer.byteLength(text), files: Object.keys(files) };
}

function load(bundlePath) {
  const b = JSON.parse(fs.readFileSync(bundlePath, 'utf8'));
  if (b.schema_version !== SCHEMA || !b.files || !b.manifest) throw new Error(`${bundlePath} is not a state bundle (schema ${SCHEMA})`);
  return b;
}

// Restore into a folder. A file there that differs from the bundle and was changed after the
// bundle was made is newer: refuse unless force.
function importBundle(bundlePath, into, force = false) {
  const b = load(bundlePath);
  const root = path.resolve(into);
  const exported = new Date(b.exported_at).getTime();
  const newer = [];
  for (const [p, t] of Object.entries(b.files)) {
    const abs = path.join(root, p);
    if (!fs.existsSync(abs)) continue;
    if (fs.readFileSync(abs, 'utf8') !== t && fs.statSync(abs).mtimeMs > exported) newer.push(p);
  }
  if (newer.length && !force) return { ok: false, newer };
  for (const [p, t] of Object.entries(b.files)) {
    const abs = path.join(root, p);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, t);
    if (fs.readFileSync(abs, 'utf8') !== t) throw new Error(`write to ${abs} did not stick`);
  }
  return { ok: true, restored: Object.keys(b.files), newer };
}

// What changed in `folder` since the bundle, to copy back to the source. A source file whose hash
// no longer matches the manifest changed there meanwhile: a conflict, and nothing is returned for it.
function writeback(bundlePath, folder, sourceHashes = {}, now = new Date()) {
  const b = load(bundlePath);
  const current = collect(folder, now.toISOString().slice(0, 10));
  const files = [];
  const conflicts = [];
  for (const [p, t] of Object.entries(current)) {
    if (b.files[p] === t) continue;
    const there = sourceHashes[p];
    const was = b.manifest[p];
    if (there !== undefined && there !== (was === undefined ? null : was)) { conflicts.push(p); continue; }
    files.push({ path: p, content_b64: Buffer.from(t, 'utf8').toString('base64') });
  }
  return { files, conflicts };
}

module.exports = { exportBundle, importBundle, writeback, collect, sha };
