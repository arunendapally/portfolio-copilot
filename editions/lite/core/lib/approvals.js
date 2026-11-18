'use strict';
// Approvals and used-row markers, kept outside the investor folder (security review, 18-Nov-2026).
// A draft file says what was proposed; it is not proof of approval, because anything that can
// write files could mark it "approved". The proof is a record the approval hook writes in the
// per-machine folder, sealed with a key only the hooks read: HMAC(key, code|hash|at). The state
// guard hook denies file and shell tools that touch this folder.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { configDir, readJson, writeJson } = require('./state');

const dir = () => path.join(configDir(), 'approvals');
const keyFile = () => path.join(configDir(), 'approval.key');

function key() {
  const f = keyFile();
  try { return fs.readFileSync(f, 'utf8').trim(); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const k = crypto.randomBytes(32).toString('hex');
  try { fs.writeFileSync(f, k, { flag: 'wx', mode: 0o600 }); } catch (e) { if (e.code !== 'EEXIST') throw e; }
  return fs.readFileSync(f, 'utf8').trim();
}

const mac = (code, hash, at) => crypto.createHmac('sha256', key()).update(`${code}|${hash}|${at}`).digest('hex');

function record(code, hash, now = new Date(), via = 'inline question') {
  const at = now.toISOString();
  const rec = { code, hash, at, via, mac: mac(code, hash, at) };
  writeJson(path.join(dir(), `${code}.json`), rec, 0o600);
  return rec;
}

// The sealed record for a code, or null when there is none or the seal does not match.
function valid(code, hash) {
  const rec = readJson(path.join(dir(), `${code}.json`), null);
  if (!rec || rec.code !== code || rec.hash !== hash) return null;
  const want = mac(rec.code, rec.hash, rec.at);
  if (!rec.mac || rec.mac.length !== want.length || !crypto.timingSafeEqual(Buffer.from(rec.mac), Buffer.from(want))) return null;
  return rec;
}

const marker = (code, idx) => path.join(dir(), `${code}.row${idx}.used`);

// Created exclusively, so two parallel calls cannot both claim the same row.
function claim(code, idx) {
  try {
    fs.mkdirSync(dir(), { recursive: true });
    fs.closeSync(fs.openSync(marker(code, idx), 'wx'));
    return true;
  } catch (e) {
    if (e.code === 'EEXIST') return false;
    throw e;
  }
}

const used = (code, idx) => fs.existsSync(marker(code, idx));

// The investor's own answer to a review task question (Approve, Defer, Decline), written by the
// approval hook and sealed like an approval. review.decide reads it to say how a decision came in.
const TASK_RE = /^t_[0-9a-f]+$/;
const answerFile = (task) => path.join(dir(), 'answers', `${task}.json`);

function recordAnswer(task, decision, now = new Date()) {
  if (!TASK_RE.test(task)) throw new Error(`not a task id: ${task}`);
  const at = now.toISOString();
  const rec = { task, decision, at, mac: mac(`task:${task}`, decision, at) };
  writeJson(answerFile(task), rec, 0o600);
  return rec;
}

// The sealed answer for a task, or null when there is none or the seal does not match.
function answer(task) {
  if (!TASK_RE.test(String(task))) return null;
  const rec = readJson(answerFile(task), null);
  if (!rec || rec.task !== task) return null;
  const want = mac(`task:${task}`, rec.decision, rec.at);
  if (!rec.mac || rec.mac.length !== want.length || !crypto.timingSafeEqual(Buffer.from(rec.mac), Buffer.from(want))) return null;
  return rec;
}

module.exports = { record, valid, claim, used, dir, recordAnswer, answer, TASK_RE };
