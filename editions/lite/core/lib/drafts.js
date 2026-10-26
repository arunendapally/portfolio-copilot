'use strict';
// Drafts: proposed orders the investor reads in full. Approval is recorded only by the
// PostToolUse hook from the investor's own click in an inline question ("Yes, place D7K2"),
// bound to a hash of the rows, so a draft edited after approval is no longer approved.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { stateDir, configDir, readJson, writeJson } = require('./state');

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_RE = /^D[A-HJ-NP-Z2-9]{4}$/;
const YES_RE = /^Yes, place (D[A-HJ-NP-Z2-9]{4})$/;
const TTL_MS = 24 * 3600 * 1000;

function draftsDir(folder) {
  return path.join(stateDir(folder), 'drafts');
}

function hashRows(rows) {
  return crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex');
}

function newCode(exists) {
  for (;;) {
    let c = 'D';
    for (const b of crypto.randomBytes(4)) c += ALPHABET[b % ALPHABET.length];
    if (!exists(c)) return c;
  }
}

function file(folder, code) {
  return path.join(draftsDir(folder), `${code}.json`);
}

function load(folder, code) {
  if (!CODE_RE.test(code)) return null;
  return readJson(file(folder, code), null);
}

function save(folder, d) {
  writeJson(file(folder, d.code), d);
}

function create(folder, kind, rows, extra = {}) {
  const code = newCode((c) => fs.existsSync(file(folder, c)));
  const d = { code, kind, created_at: new Date().toISOString(), created_hash: hashRows(rows), status: 'draft', rows, ...extra };
  save(folder, d);
  return d;
}

// Called by the hook after the investor clicked "Yes, place <code>". Null when no open draft.
function approve(folder, code, now = new Date(), via = 'inline question') {
  const d = load(folder, code);
  if (!d || d.status !== 'draft') return null;
  d.status = 'approved';
  d.approved_at = now.toISOString();
  d.approved_hash = hashRows(d.rows);
  d.approved_via = via;
  save(folder, d);
  return { code, rows: d.rows.length };
}

// ---- remote approvals (cloud session linked to the investor's PC, issue #9) --------------
// The hook runs in the cloud and cannot see drafts kept on the PC. It records the click here;
// the order gate lets exactly one matching execute_draft through and consumes the record.

function remoteFile() {
  return path.join(configDir(), 'approvals.json');
}

function recordRemote(code, now = new Date()) {
  const all = readJson(remoteFile(), {});
  all[code] = { approved_at: now.toISOString() };
  writeJson(remoteFile(), all, 0o600);
}

function consumeRemote(code, now = new Date()) {
  const all = readJson(remoteFile(), {});
  const r = all[code];
  if (!r) return false;
  delete all[code];
  writeJson(remoteFile(), all, 0o600);
  return now - new Date(r.approved_at) <= TTL_MS;
}

// Server side: accept an approval the cloud gate passed through. Only for an untouched draft
// younger than the TTL; the caller checks the profile opt-in first.
function acceptRemote(folder, code, now = new Date()) {
  const d = load(folder, code);
  if (!d) return { ok: false, reason: `no draft ${code}` };
  if (d.status !== 'draft') return { ok: false, reason: `draft ${code} is ${d.status}` };
  if (now - new Date(d.created_at) > TTL_MS) return { ok: false, reason: `draft ${code} is older than 24 h` };
  if (!d.created_hash || hashRows(d.rows) !== d.created_hash) return { ok: false, reason: `draft ${code} changed since it was shown (or predates v0.5.1): draft it again` };
  approve(folder, code, now, 'inline question, cloud gate');
  return { ok: true };
}

function verify(folder, code, now = new Date()) {
  const d = load(folder, code);
  if (!d) return { ok: false, reason: `no draft ${code}` };
  if (d.status !== 'approved') return { ok: false, reason: `draft ${code} is ${d.status}, not approved by you` };
  if (now - new Date(d.approved_at) > TTL_MS) return { ok: false, reason: `approval of ${code} is older than 24 h` };
  if (hashRows(d.rows) !== d.approved_hash) return { ok: false, reason: `draft ${code} changed after approval` };
  return { ok: true, draft: d };
}

function approvedDrafts(folder, now = new Date()) {
  let names = [];
  try { names = fs.readdirSync(draftsDir(folder)).filter((f) => f.endsWith('.json')); } catch { return []; }
  return names.map((f) => verify(folder, f.slice(0, -5), now)).filter((v) => v.ok).map((v) => v.draft);
}

module.exports = { CODE_RE, YES_RE, create, load, save, approve, verify, approvedDrafts, hashRows, draftsDir, recordRemote, consumeRemote, acceptRemote };
