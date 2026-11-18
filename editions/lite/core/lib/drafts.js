'use strict';
// Drafts: proposed orders the investor reads in full. Approval is recorded only by the
// PostToolUse hook from the investor's own click in an inline question ("Yes, place D7K2"),
// bound to a hash of the rows, so a draft edited after approval is no longer approved.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { stateDir, readJson, writeJson } = require('./state');
const approvals = require('./approvals');

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
  // The file's status is not trusted either way: a draft already approved for these rows is not approved twice.
  if (!d || approvals.valid(code, hashRows(d.rows))) return null;
  // The sealed record is the approval; the status in the draft file is only for display.
  const rec = approvals.record(code, hashRows(d.rows), now, via);
  d.status = 'approved';
  d.approved_at = rec.at;
  d.approved_hash = rec.hash;
  d.approved_via = via;
  save(folder, d);
  return { code, rows: d.rows.length };
}

// Each row of an approved draft may be used for exactly one broker call. The marker file is
// created exclusively, so two parallel calls cannot both claim the same row.
function claimRow(folder, code, idx) {
  return approvals.claim(code, idx);
}

function rowUsed(folder, code, idx) {
  return approvals.used(code, idx);
}

function verify(folder, code, now = new Date()) {
  const d = load(folder, code);
  if (!d) return { ok: false, reason: `no draft ${code}` };
  // Only a sealed record for exactly these rows counts; a file edited to say "approved" does not.
  const rec = approvals.valid(code, hashRows(d.rows));
  if (!rec) return { ok: false, reason: `draft ${code} has no approval of yours for these exact rows` };
  if (now - new Date(rec.at) > TTL_MS) return { ok: false, reason: `approval of ${code} is older than 24 h` };
  return { ok: true, draft: { ...d, status: 'approved', approved_at: rec.at, approved_hash: rec.hash } };
}

function approvedDrafts(folder, now = new Date()) {
  let names = [];
  try { names = fs.readdirSync(draftsDir(folder)).filter((f) => f.endsWith('.json')); } catch { return []; }
  return names.map((f) => verify(folder, f.slice(0, -5), now)).filter((v) => v.ok).map((v) => v.draft);
}

module.exports = { CODE_RE, YES_RE, create, load, save, approve, verify, approvedDrafts, hashRows, draftsDir, claimRow, rowUsed };
