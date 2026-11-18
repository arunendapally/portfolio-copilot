'use strict';
// State bundle (spec 002 US6, data-model section 8): the investor's state as one JSON file, so a
// cloud chat and the computer work on the same files and never drift silently.
// The log goes in whole (it holds only the current month), so writing it back loses nothing.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { resolveFolder, STATE_DIRNAME, listSnapshots } = require('./state');
const { istDate } = require('./format');

const SCHEMA = 1;
const JOURNAL_LINES = 200;
// The journal travels as its last lines only, for reading: it is never written back, and import
// never overwrites a journal already there, so the full history on the computer stays whole.
const JOURNAL = `${STATE_DIRNAME}/journal.jsonl`;

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
    // A draft travels as a draft: approval stays with the machine where the investor clicked.
    add(rel('drafts', f), (t) => { try { const x = JSON.parse(t); return JSON.stringify({ ...x, status: 'draft', approved_at: undefined, approved_hash: undefined, approved_via: undefined }, null, 2); } catch { return t; } });
  }
  for (const f of list(root, rel('runs'))) if (today && f.startsWith(today)) add(rel('runs', f));
  add(rel('marks.json'));
  add(rel('journal.jsonl'), (t) => t.split(/\r?\n/).filter(Boolean).slice(-JOURNAL_LINES).join('\n') + '\n');
  add(rel('log.md'));
  return files;
}

function exportBundle(folder, out, now, source = 'pc') {
  const files = collect(folder, istDate(now));
  const manifest = Object.fromEntries(Object.entries(files).map(([p, t]) => [p, sha(t)]));
  const bundle = { schema_version: SCHEMA, exported_at: now.toISOString(), source, manifest, files };
  const text = JSON.stringify(bundle);
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(out, text);
  if (fs.readFileSync(out, 'utf8') !== text) throw new Error(`bundle write to ${out} did not stick`);
  return { path: path.resolve(out), bytes: Buffer.byteLength(text), files: Object.keys(files) };
}

// portfolio-copilot/<name> or portfolio-copilot/<dir>/<name>, plain names only.
function safePath(p) {
  return typeof p === 'string' && /^portfolio-copilot\/(?:[A-Za-z0-9_.-]+\/)?[A-Za-z0-9_.-]+$/.test(p) && !p.split('/').some((x) => x === '..' || x === '.');
}

function load(bundlePath) {
  const b = JSON.parse(fs.readFileSync(bundlePath, 'utf8'));
  if (b.schema_version !== SCHEMA || !b.files || !b.manifest) throw new Error(`${bundlePath} is not a state bundle (schema ${SCHEMA})`);
  // Every file must sit inside the state folder and match the manifest made at export.
  for (const [p, t] of Object.entries(b.files)) {
    if (!safePath(p)) throw new Error(`bundle path refused: ${p}`);
    if (b.manifest[p] !== sha(t)) throw new Error(`bundle file does not match its manifest: ${p}`);
    if (/\.used$/.test(p)) throw new Error(`bundle path refused: ${p}`);
  }
  return b;
}

// Restore into a folder. A file there that differs from the bundle and was changed after the
// bundle was made is newer: refuse unless force.
function importBundle(bundlePath, into, force = false) {
  const b = load(bundlePath);
  const root = path.resolve(into);
  const exported = new Date(b.exported_at).getTime();
  const newer = [];
  const keep = new Set();
  for (const [p, t] of Object.entries(b.files)) {
    const abs = path.join(root, p);
    if (!fs.existsSync(abs)) continue;
    if (p === JOURNAL) { keep.add(p); continue; }
    if (fs.readFileSync(abs, 'utf8') !== t && fs.statSync(abs).mtimeMs > exported) newer.push(p);
  }
  if (newer.length && !force) return { ok: false, newer };
  for (const [p, t] of Object.entries(b.files)) {
    if (keep.has(p)) continue;
    const abs = path.join(root, p);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, t);
    if (fs.readFileSync(abs, 'utf8') !== t) throw new Error(`write to ${abs} did not stick`);
  }
  return { ok: true, restored: Object.keys(b.files).filter((p) => !keep.has(p)), newer };
}

// What changed in `folder` since the bundle, to copy back to the source. A source file whose hash
// no longer matches the manifest changed there meanwhile: a conflict, and nothing is returned for it.
function writeback(bundlePath, folder, sourceHashes = {}, now = new Date()) {
  const b = load(bundlePath);
  const current = collect(folder, istDate(now));
  for (const p of Object.keys(current)) if (!safePath(p) || p === JOURNAL) delete current[p];
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

module.exports = { exportBundle, importBundle, writeback, collect, sha, safePath };
