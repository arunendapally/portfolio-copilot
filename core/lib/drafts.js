'use strict';
// Drafts: proposed orders the investor reads in full. Approval is recorded only by the
// UserPromptSubmit hook from the investor's own message ("approve D7K2"), bound to a hash of
// the rows, so a draft edited after approval is no longer approved.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { stateDir, readJson, writeJson } = require('./state');

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_RE = /^D[A-HJ-NP-Z2-9]{4}$/;
const APPROVE_RE = /\bapprove\s+(D[A-HJ-NP-Z2-9]{4})\b/gi;
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
  const d = { code, kind, created_at: new Date().toISOString(), status: 'draft', rows, ...extra };
  save(folder, d);
  return d;
}

// Called by the hook with the investor's prompt text. Returns codes approved / not found.
function approveFromPrompt(folder, prompt, now = new Date()) {
  const approved = [];
  const missing = [];
  for (const m of String(prompt).matchAll(APPROVE_RE)) {
    const code = m[1].toUpperCase();
    const d = load(folder, code);
    if (!d || d.status !== 'draft') { missing.push(code); continue; }
    d.status = 'approved';
    d.approved_at = now.toISOString();
    d.approved_hash = hashRows(d.rows);
    save(folder, d);
    approved.push({ code, rows: d.rows.length });
  }
  return { approved, missing };
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

module.exports = { CODE_RE, APPROVE_RE, create, load, save, approveFromPrompt, verify, approvedDrafts, hashRows, draftsDir };
