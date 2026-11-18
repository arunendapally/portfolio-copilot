'use strict';
// Kite collector on the free Personal plan of Kite Connect (research R6, decided 18-Nov-2026).
// Read-only: holdings, GTTs, margins, positions, fund holdings, orders. One login per trading
// day by the broker's redirect; the access token is valid only for that trading day.
// Secrets: ~/.portfolio-copilot/secrets/kite.json { api_key, api_secret, access_token, token_day }.

const crypto = require('crypto');
const c = require('./index');

const BASE = 'https://api.kite.trade';
const READS = { holdings: '/portfolio/holdings', gtts: '/gtt/triggers', margins: '/user/margins', positions: '/portfolio/positions', mf: '/mf/holdings', orders: '/orders' };
const LOGIN_RE = /TokenException|invalid.*token|token.*(expired|invalid)|incorrect `api_key` or `access_token`/i;

// The trading day a token was made for (IST date); a token from an earlier day has expired.
const istDay = (d) => new Date(d.getTime() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);

module.exports = function kite({ fetch: fetchImpl = globalThis.fetch, now = () => new Date() } = {}) {
  const secrets = () => c.readSecrets('kite');

  function loginStep(s) {
    return {
      url: `https://kite.zerodha.com/connect/login?v=3&api_key=${encodeURIComponent(s.api_key)}`,
      steps: ['Open the Kite login link and log in', 'Your browser lands on the redirect address of your Kite app; copy the request_token from that address', 'Give it to Claude (portfolio_status with login), or run: node local/collect.js --login kite --request-token <token>'],
    };
  }

  async function status() {
    const s = secrets();
    if (!s || !s.api_key || !s.api_secret) return { state: 'needs_login', detail: 'no Kite app keys yet', login: { steps: ['Create a Kite Connect app (Personal plan, free) at developers.kite.trade with a redirect address on localhost', 'Save api_key and api_secret in ~/.portfolio-copilot/secrets/kite.json'] } };
    if (!s.access_token || s.token_day !== istDay(now())) return { state: 'needs_login', detail: 'the daily Kite login is due', login: loginStep(s) };
    return { state: 'ready', detail: `logged in for ${s.token_day}` };
  }

  // The one manual step per day: exchange the request token for the day's access token.
  async function login({ request_token: rt } = {}) {
    const s = secrets();
    if (!s || !s.api_key || !s.api_secret) return { state: 'needs_login', detail: 'no Kite app keys yet' };
    if (!rt) return { state: 'needs_login', detail: 'request_token required' };
    const checksum = crypto.createHash('sha256').update(s.api_key + rt + s.api_secret).digest('hex');
    // The session exchange is the only POST: it creates a session and can change nothing in the account.
    const res = await fetchImpl(`${BASE}/session/token`, { method: 'POST', headers: { 'X-Kite-Version': '3', 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ api_key: s.api_key, request_token: rt, checksum }).toString() });
    const j = JSON.parse(await res.text());
    if (!res.ok || !j.data || !j.data.access_token) return { state: 'error', detail: `Kite refused the login: ${(j && j.message) || res.status}` };
    c.writeSecrets('kite', { ...s, access_token: j.data.access_token, token_day: istDay(now()) });
    return { state: 'ready', detail: 'logged in for today' };
  }

  async function pull(caps = Object.keys(READS)) {
    const st = await status();
    if (st.state !== 'ready') return { written: [], partial: [], errors: [st.detail], state: st.state };
    const s = secrets();
    const headers = { 'X-Kite-Version': '3', Authorization: `token ${s.api_key}:${s.access_token}` };
    const written = [];
    const errors = [];
    for (const cap of caps.filter((x) => READS[x])) {
      const r = await c.get(fetchImpl, BASE + READS[cap], headers);
      if (!r.ok) {
        if (LOGIN_RE.test(r.text) || r.status === 403) { c.writeSecrets('kite', { ...s, access_token: null }); return { written, partial: [], errors: ['the Kite session ended: log in again'], state: 'needs_login' }; }
        errors.push(`${cap}: HTTP ${r.status}`);
        continue;
      }
      const j = JSON.parse(r.text);
      c.save('kite', cap, j.data, { tool: `local:kite:${READS[cap]}`, now: now() });
      written.push(cap);
    }
    return { written, partial: [], errors, state: 'ready' };
  }

  return { broker: 'kite', status, login, pull, READS };
};
