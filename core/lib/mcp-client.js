'use strict';
// Minimal MCP client over streamable HTTP (JSON-RPC POST). Owns the MCP session id so a
// broker login stays bound to it across Claude restarts, retries once on transport failure,
// and separates transport failures (outage) from tool-level errors (handled by callers).

const PROTOCOL_VERSION = '2025-03-26';

class TransportError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'TransportError';
    this.status = status;
  }
}

function parseBody(contentType, text, id) {
  if (contentType && contentType.includes('text/event-stream')) {
    for (const block of text.split(/\r?\n\r?\n/)) {
      const data = block.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('');
      if (!data) continue;
      const msg = JSON.parse(data);
      if (msg.id === id) return msg;
    }
    throw new TransportError('No response message in event stream');
  }
  return JSON.parse(text);
}

class McpHttpClient {
  constructor(url, { sessionId = null, onSession = () => {}, timeoutMs = 20000, fetchImpl = globalThis.fetch, clientName = 'portfolio-core' } = {}) {
    this.url = url;
    this.sessionId = sessionId;
    this.onSession = onSession;
    this.timeoutMs = timeoutMs;
    this.fetch = fetchImpl;
    this.clientName = clientName;
    this.nextId = 1;
    this.initialized = !!sessionId;
  }

  async post(body, { retry = true } = {}) {
    const attempt = async () => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
      const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
      if (this.sessionId) headers['Mcp-Session-Id'] = this.sessionId;
      try {
        const res = await this.fetch(this.url, { method: 'POST', headers, body: JSON.stringify(body), signal: ctrl.signal });
        const sid = res.headers.get('mcp-session-id');
        if (sid && sid !== this.sessionId) {
          this.sessionId = sid;
          this.onSession(sid);
        }
        if (res.status === 404 && this.sessionId && body.method !== 'initialize') {
          const e = new TransportError('MCP session expired', 404);
          e.sessionExpired = true;
          throw e;
        }
        // Kite answers a dead session with "HTTP 400: Invalid session ID" (26-Oct-2026), not 404.
        if (res.status === 400 && this.sessionId && body.method !== 'initialize') {
          const t = await res.text();
          const e = new TransportError(`HTTP 400: ${t.slice(0, 200)}`, 400);
          if (/session/i.test(t)) e.sessionExpired = true;
          throw e;
        }
        if (res.status >= 500) throw new TransportError(`HTTP ${res.status}`, res.status);
        if (res.status === 202 || body.id === undefined) return null;
        if (res.status >= 400) throw new TransportError(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`, res.status);
        return parseBody(res.headers.get('content-type'), await res.text(), body.id);
      } catch (e) {
        if (e instanceof TransportError) throw e;
        if (e.name === 'AbortError') throw new TransportError(`Timed out after ${this.timeoutMs} ms`);
        if (e instanceof SyntaxError) throw new TransportError(`Bad JSON from server: ${e.message}`);
        throw new TransportError(e.message);
      } finally {
        clearTimeout(timer);
      }
    };
    try {
      return await attempt();
    } catch (e) {
      // One silent retry for timeouts and 5xx; never for an expired session or a 4xx.
      if (!retry || e.sessionExpired || (e.status && e.status < 500)) throw e;
      return attempt();
    }
  }

  async initialize() {
    this.sessionId = null;
    const res = await this.post({
      jsonrpc: '2.0', id: this.nextId++, method: 'initialize',
      params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: this.clientName, version: '0.6.0' } },
    });
    if (res && res.error) throw new TransportError(`initialize failed: ${res.error.message}`);
    await this.post({ jsonrpc: '2.0', method: 'notifications/initialized' });
    this.initialized = true;
    return res && res.result;
  }

  // Returns { isError, text }. Throws TransportError for outages.
  async callTool(name, args = {}) {
    if (!this.initialized) await this.initialize();
    const call = () => this.post({ jsonrpc: '2.0', id: this.nextId++, method: 'tools/call', params: { name, arguments: args } });
    let res;
    try {
      res = await call();
    } catch (e) {
      if (!e.sessionExpired) throw e;
      await this.initialize();
      res = await call();
    }
    if (res.error) return { isError: true, text: res.error.message || 'error', rpcError: true };
    const content = (res.result && res.result.content) || [];
    const text = content.filter((c) => c.type === 'text').map((c) => c.text).join('\n');
    return { isError: !!(res.result && res.result.isError), text };
  }
}

// Parse a tool's text payload as JSON when it is JSON; else return null.
function asJson(text) {
  if (!text) return null;
  const t = text.trim();
  if (!(t.startsWith('{') || t.startsWith('['))) return null;
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
}

module.exports = { McpHttpClient, TransportError, asJson, PROTOCOL_VERSION };
