'use strict';
// Test helpers: isolated temp folders and a scriptable fake broker.

const fs = require('fs');
const os = require('os');
const path = require('path');

function tmpEnv() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-test-'));
  const folder = path.join(root, 'work');
  fs.mkdirSync(folder);
  process.env.PORTFOLIO_COPILOT_CONFIG_DIR = path.join(root, 'config');
  delete process.env.PORTFOLIO_COPILOT_HOME;
  return { root, folder };
}

function fixture(name) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8'));
}

function writeProfile(folder, profile) {
  const p = path.join(folder, 'portfolio-copilot', 'profile.json');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(profile, null, 2));
}

// Fake kite/kotak modules with the same interface as core/lib/brokers/*.
function fakeBrokers({ kite = {}, kotak = {} } = {}) {
  const calls = [];
  return {
    calls,
    kite: {
      status: async () => kite.status || { status: 'live' },
      login: async () => ({ ok: true, link: 'https://mcp.kite.trade/authorize?session_id=test' }),
      fetchAll: async () => kite.data,
      ltp: async (inst) => Object.fromEntries(inst.map((i) => [i, (kite.ltp || {})[i]])),
      placeGtt: async (args) => { calls.push(['place', args]); if (kite.placeFails) throw new Error('rejected'); return { trigger_id: 999 }; },
      deleteGtt: async (id) => { calls.push(['delete', id]); if (kite.deleteFails) throw new Error("parameter 'trigger_id': is required"); return {}; },
    },
    kotak: {
      status: async () => kotak.status || { status: 'live' },
      loginStart: async () => ({ ok: true, link: 'https://kotak.example/login', instructions: 'scan' }),
      loginValidate: async () => ({ ok: true }),
      fetchAll: async () => kotak.data,
    },
  };
}

function ctxAt(iso, brokers, edition = 'full') {
  return { edition, brokers, now: () => new Date(iso) };
}

module.exports = { tmpEnv, fixture, writeProfile, fakeBrokers, ctxAt };
