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

// What the PostToolUse capture hook would have saved from the brokers' own MCP tools.
// fakeBrokers describes the broker state; ctxAt seeds it (as of the context's clock).
function fakeBrokers({ kite = {}, kotak = {} } = {}) {
  const session = require('../core/lib/session');
  const calls = [];
  const seed = (now) => {
    const rec = (tool, payload, failText) => {
      if (failText) return session.record(tool, { isError: true, content: [{ type: 'text', text: failText }] }, now);
      return session.record(tool, typeof payload === 'string' ? payload : JSON.stringify(payload), now);
    };
    const st = kite.status && kite.status.status;
    if (st === 'needs_login') rec('mcp__kite__get_holdings', null, 'Invalid session: please log in');
    else if (st === 'outage') rec('mcp__kite__get_holdings', null, 'upstream 502 bad gateway');
    else if (kite.data) {
      rec('mcp__kite__get_holdings', kite.data.holdings);
      rec('mcp__kite__get_mf_holdings', kite.data.mf || []);
      rec('mcp__kite__get_gtts', kite.data.gtts);
      rec('mcp__kite__get_margins', kite.data.margins);
      rec('mcp__kite__get_orders', kite.data.orders || []);
      rec('mcp__kite__get_trades', kite.data.trades || []);
    }
    if (kite.ltp) rec('mcp__kite__get_ltp', Object.fromEntries(Object.entries(kite.ltp).map(([k, v]) => [k, { last_price: v }])));
    const ks = kotak.status && kotak.status.status;
    if (ks === 'needs_login') rec('mcp__kotak-neo__get_holdings', null, 'Session expired, please login again');
    else if (ks === 'outage') rec('mcp__kotak-neo__get_holdings', null, 'upstream 502 bad gateway');
    else if (kotak.data) {
      rec('mcp__kotak-neo__get_holdings', kotak.data.text);
      rec('mcp__kotak-neo__get_limits', { Net: kotak.data.cash });
    }
  };
  return { calls, seed, kite, kotak };
}

function ctxAt(iso, brokers, edition = 'full') {
  const now = new Date(iso);
  if (brokers && brokers.seed) brokers.seed(now);
  return { edition, now: () => now };
}

module.exports = { tmpEnv, fixture, writeProfile, fakeBrokers, ctxAt };
