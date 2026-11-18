'use strict';
// Collector interface (spec 002 contracts/local-engine.md) and what every collector shares:
// secrets in the per-machine folder only, and captures written exactly as the chat hook writes
// them. Collectors are read-only: there is no write path here, and tests check it.
//
//   { broker, status(), login(input), pull(caps) }

const fs = require('fs');
const path = require('path');
const { configDir, readJson, writeJson } = require('../../core/lib/state');
const session = require('../../core/lib/session');

function secretsFile(broker) {
  return path.join(configDir(), 'secrets', `${broker}.json`);
}

function readSecrets(broker) {
  return readJson(secretsFile(broker), null);
}

function writeSecrets(broker, data) {
  writeJson(secretsFile(broker), data, 0o600);
}

// Only GET requests leave a collector. Anything else is refused here, whatever a collector asks.
async function get(fetchImpl, url, headers = {}) {
  const res = await fetchImpl(url, { method: 'GET', headers });
  const text = await res.text();
  return { status: res.status, ok: res.ok, text };
}

function save(broker, cap, data, { tool, now, partial = false } = {}) {
  return session.saveLocal(broker, cap, typeof data === 'string' ? data : JSON.stringify(data), { tool, now, partial });
}

function load(broker, deps = {}) {
  const make = require(`./${broker}`);
  return make(deps);
}

const BROKERS = ['kite', 'kotak', 'ibkr'];

module.exports = { secretsFile, readSecrets, writeSecrets, get, save, load, BROKERS, fileExists: (p) => fs.existsSync(p) };
