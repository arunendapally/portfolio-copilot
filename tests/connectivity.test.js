'use strict';
// US1: connect once. A local fake MCP server reproduces the Kite behaviours seen in the field.
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const { tmpEnv } = require('./helpers');

function fakeKite({ failFirst = 0, sse = false, deadSession = 404 } = {}) {
  const sessions = new Map(); // id -> { authorised, calls }
  let n = 0;
  let failures = failFirst;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      if (failures > 0) { failures--; res.writeHead(502); return res.end('bad gateway'); }
      const msg = JSON.parse(body);
      const sid = req.headers['mcp-session-id'];
      const send = (result) => {
        const payload = JSON.stringify({ jsonrpc: '2.0', id: msg.id, result });
        if (sse) { res.writeHead(200, { 'content-type': 'text/event-stream' }); return res.end(`event: message\ndata: ${payload}\n\n`); }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(payload);
      };
      if (msg.method === 'initialize') {
        const id = `kitemcp-${++n}`;
        sessions.set(id, { authorised: false, calls: 0 });
        res.setHeader('mcp-session-id', id);
        return send({ protocolVersion: '2025-03-26', capabilities: {}, serverInfo: { name: 'fake' } });
      }
      if (msg.method === 'notifications/initialized') { res.writeHead(202); return res.end(); }
      const s = sessions.get(sid);
      if (!s) { res.writeHead(deadSession); return res.end(deadSession === 400 ? 'Invalid session ID\n' : ''); }
      const name = msg.params.name;
      if (name === 'login') return send({ content: [{ type: 'text', text: `Show the warning. [Login to Kite](https://mcp.kite.trade/authorize?session_id=${sid})` }] });
      if (!s.authorised) {
        s.calls++;
        return send({ isError: true, content: [{ type: 'text', text: s.calls === 1 ? 'Please log in first using the login tool' : `Failed to execute ${name}` }] });
      }
      if (name === 'get_profile') return send({ content: [{ type: 'text', text: JSON.stringify({ user_id: 'AB1234' }) }] });
      return send({ content: [{ type: 'text', text: '[]' }] });
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, sessions, url: `http://127.0.0.1:${server.address().port}/mcp` })));
}

function loadKite(url) {
  process.env.KITE_MCP_URL = url;
  delete require.cache[require.resolve('../core/lib/brokers/kite')];
  return require('../core/lib/brokers/kite');
}

test('no session yet => needs_login without a network call', async () => {
  tmpEnv();
  const kite = loadKite('http://127.0.0.1:9/never');
  assert.strictEqual((await kite.status()).status, 'needs_login');
});

test('"Failed to execute" on an unauthorised session is needs_login, not outage (research R2)', async () => {
  tmpEnv();
  const f = await fakeKite();
  const kite = loadKite(f.url);
  const l = await kite.login();
  assert.ok(l.ok);
  assert.match(l.link, /authorize\?session_id=kitemcp-1$/);
  assert.strictEqual((await kite.status()).status, 'needs_login'); // "Please log in first"
  assert.strictEqual((await kite.status()).status, 'needs_login'); // "Failed to execute"
  f.server.close();
});

test('login link comes from the login tool and binds to the persisted session', async () => {
  tmpEnv();
  const f = await fakeKite();
  const kite = loadKite(f.url);
  const l = await kite.login();
  const sid = l.link.split('session_id=')[1];
  f.sessions.get(sid).authorised = true; // investor authorises in the browser
  const s = await kite.status();
  assert.strictEqual(s.status, 'live');
  // A new process (Claude restart) reuses the same session from disk.
  const again = loadKite(f.url);
  assert.strictEqual((await again.status()).status, 'live');
  assert.strictEqual(f.sessions.size, 1);
  f.server.close();
});

test('login always starts a fresh session (no stale session re-use)', async () => {
  tmpEnv();
  const f = await fakeKite();
  const kite = loadKite(f.url);
  const a = await kite.login();
  const b = await kite.login();
  assert.notStrictEqual(a.link, b.link);
  f.server.close();
});

test('one silent retry absorbs a first-call gateway failure', async () => {
  tmpEnv();
  const f = await fakeKite({ failFirst: 1 });
  const kite = loadKite(f.url);
  const l = await kite.login();
  assert.ok(l.ok, 'retry should have succeeded');
  f.server.close();
});

test('persistent transport failure is outage', async () => {
  tmpEnv();
  const f = await fakeKite();
  const kite = loadKite(f.url);
  await kite.login();
  f.server.close();
  f.server.closeAllConnections(); // Node 18 keeps keep-alive sockets open after close()
  await new Promise((r) => setTimeout(r, 50));
  const s = await kite.status();
  assert.strictEqual(s.status, 'outage');
});

test('event-stream responses are parsed', async () => {
  tmpEnv();
  const f = await fakeKite({ sse: true });
  const kite = loadKite(f.url);
  assert.ok((await kite.login()).ok);
  f.server.close();
});

test('expired MCP session (404) re-initialises transparently', async () => {
  tmpEnv();
  const f = await fakeKite();
  const kite = loadKite(f.url);
  await kite.login();
  f.sessions.clear(); // server forgot every session
  const s = await kite.status();
  assert.strictEqual(s.status, 'needs_login');
  f.server.close();
});

test('dead session answered with "HTTP 400: Invalid session ID" is needs_login, not outage (issue #3)', async () => {
  tmpEnv();
  const f = await fakeKite({ deadSession: 400 });
  const kite = loadKite(f.url);
  await kite.login();
  f.sessions.clear();
  const s = await kite.status();
  assert.strictEqual(s.status, 'needs_login');
  f.server.close();
});

test('kotak session id and link are extracted from get_login text', () => {
  const kotak = require('../core/lib/brokers/kotak');
  assert.strictEqual(kotak.extractSessionId('{"sessionid":"abc-123-def","link":"https://x"}'), 'abc-123-def');
  assert.strictEqual(kotak.extractSessionId('Your sessionid: 9f8e7d6c5b4a'), '9f8e7d6c5b4a');
});
