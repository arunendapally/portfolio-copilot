'use strict';
// File-backed state. Portfolio state lives in <working folder>/portfolio-copilot/.
// Broker session ids live in the user's home config dir, never in the working folder.

const fs = require('fs');
const path = require('path');
const os = require('os');

const STATE_DIRNAME = 'portfolio-copilot';
const KEEP_SNAPSHOTS = 30;

function configDir() {
  return process.env.PORTFOLIO_COPILOT_CONFIG_DIR || path.join(os.homedir(), '.portfolio-copilot');
}

function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return fallback;
    throw new Error(`Cannot read ${file}: ${e.message}`);
  }
}

function writeJson(file, data, mode) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', mode ? { mode } : undefined);
  fs.renameSync(tmp, file);
  if (mode) {
    try { fs.chmodSync(file, mode); } catch { /* Windows: best effort */ }
  }
}

// ---- session store ---------------------------------------------------------

function sessionsFile() {
  return path.join(configDir(), 'sessions.json');
}

function loadSessions() {
  return readJson(sessionsFile(), {});
}

function saveSessions(s) {
  writeJson(sessionsFile(), s, 0o600);
}

function updateSession(broker, patch) {
  const s = loadSessions();
  s[broker] = patch === null ? undefined : { ...(s[broker] || {}), ...patch };
  saveSessions(s);
  return s[broker];
}

// ---- working folder --------------------------------------------------------

function resolveFolder(folder) {
  const s = loadSessions();
  const chosen = folder || process.env.PORTFOLIO_COPILOT_HOME || s.last_folder || process.cwd();
  const abs = path.resolve(chosen);
  if (folder && s.last_folder !== abs) {
    s.last_folder = abs;
    saveSessions(s);
  }
  return abs;
}

function stateDir(folder) {
  return path.join(resolveFolder(folder), STATE_DIRNAME);
}

// ---- snapshots ---------------------------------------------------------------

function snapshotsDir(folder) {
  return path.join(stateDir(folder), 'snapshots');
}

function listSnapshots(folder) {
  try {
    return fs.readdirSync(snapshotsDir(folder)).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
}

function loadSnapshot(folder, date) {
  return readJson(path.join(snapshotsDir(folder), `${date}.json`), null);
}

function latestSnapshot(folder) {
  const all = listSnapshots(folder);
  return all.length ? loadSnapshot(folder, all[all.length - 1].slice(0, 10)) : null;
}

// Latest snapshot strictly before `date`: the comparison baseline.
function previousSnapshot(folder, date) {
  const before = listSnapshots(folder).filter((f) => f.slice(0, 10) < date);
  return before.length ? loadSnapshot(folder, before[before.length - 1].slice(0, 10)) : null;
}

function saveSnapshot(folder, date, snap) {
  writeJson(path.join(snapshotsDir(folder), `${date}.json`), snap);
  const all = listSnapshots(folder);
  for (const old of all.slice(0, Math.max(0, all.length - KEEP_SNAPSHOTS))) {
    fs.unlinkSync(path.join(snapshotsDir(folder), old));
  }
}

module.exports = {
  STATE_DIRNAME, configDir, readJson, writeJson,
  loadSessions, saveSessions, updateSession,
  resolveFolder, stateDir,
  listSnapshots, loadSnapshot, latestSnapshot, previousSnapshot, saveSnapshot,
};
