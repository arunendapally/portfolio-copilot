#!/usr/bin/env node
'use strict';
// Local engine MCP server (spec 002 US7, contracts/local-engine.md): four tools whose results are
// summaries, so broker payloads never reach the model. Hand-written stdio JSON-RPC (research R9).
// It holds no order capability: broker writes from approved drafts are passed back to the chat,
// where the order gate checks them.
//
//   node local/server.js --folder <investor folder>

const readline = require('readline');
const toolmap = require('../core/lib/brokers/toolmap');
const { callTool, makeContext } = require('../core/tools');
const collect = require('./collect');
const profiles = require('../core/lib/profile');

const MAX_TEXT = 2000;

const TOOLS = [
  { name: 'portfolio_status', description: 'Per broker: state and data time, an "All connected" line or the manual steps. Pass login { broker, request_token } to finish the daily Kite login.', inputSchema: { type: 'object', properties: { login: { type: 'object', properties: { broker: { type: 'string' }, request_token: { type: 'string' } } } } } },
  { name: 'portfolio_refresh', description: 'Pull every ready broker now, rebuild the snapshot, return the check summary.', inputSchema: { type: 'object', properties: { brokers: { type: 'array', items: { type: 'string' } } } } },
  { name: 'portfolio_review', description: 'The guided review. action: start (kind full, eod or friday), next, status, decide (task, decision approved | deferred | declined, reason, defer_until YYYY-MM-DD for deferred), done (task, result done | could_not | skipped), research (findings: array, corporate_actions: array, [] when none found). At record, next with record { todoist: synced, dashboard: updated }. Returns text and the next steps only you can do.', inputSchema: { type: 'object', properties: {
    action: { type: 'string', enum: ['start', 'next', 'status', 'decide', 'done', 'research'] },
    kind: { type: 'string', enum: ['full', 'eod', 'friday'] }, run: { type: 'string' },
    task: { type: 'string' }, decision: { type: 'string', enum: ['approved', 'deferred', 'declined'] }, reason: { type: 'string' }, defer_until: { type: 'string' },
    result: { type: 'string', enum: ['done', 'could_not', 'skipped'] }, note: { type: 'string' },
    findings: { type: 'array', items: { type: 'object' } }, corporate_actions: { type: 'array', items: { type: 'object' } },
    record: { type: 'object', properties: { todoist: { type: 'string', enum: ['synced', 'skipped'] }, dashboard: { type: 'string', enum: ['updated', 'skipped'] } } },
  }, required: ['action'] } },
  { name: 'portfolio_query', description: 'One answer from the engine. q: holding <SYM> | allocation | guardrails | gtt <SYM> | journal | decisions | export.', inputSchema: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] } },
];

const ACTIONS = { start: 'review_start', next: 'review_next', status: 'review_status', decide: 'task_decide', done: 'task_done', research: 'research_submit' };

function clip(text) {
  const t = String(text || '');
  if (Buffer.byteLength(t) <= MAX_TEXT) return t;
  let cut = t.slice(0, MAX_TEXT - 80);
  while (Buffer.byteLength(cut) > MAX_TEXT - 80) cut = cut.slice(0, -50);
  return `${cut}\n… (shortened; ask portfolio_query for the rest)`;
}

function section(text, title) {
  const lines = String(text).split('\n');
  const i = lines.findIndex((l) => l.includes(title));
  if (i < 0) return '';
  const out = [lines[i]];
  for (const l of lines.slice(i + 1)) { if (/^\*\*/.test(l) || (!l.trim() && out.length > 2)) break; out.push(l); }
  return out.join('\n');
}

function makeServer({ folder, deps = {}, ctx = makeContext() } = {}) {
  // Brokers the investor's profile turns on; the engine reports and pulls only those.
  const enabled = () => Object.entries(profiles.load(folder).profile.brokers || {}).filter(([, v]) => v && v.enabled).map(([b]) => b);

  // Broker reads in `next` are done here when a collector covers them; what is left is for the model.
  async function filterNext(steps) {
    const reads = new Set();
    const keep = [];
    for (const s of steps || []) {
      const r = s.do === 'call' ? toolmap.resolve(s.tool, s.args || {}) : null;
      if (r && r.broker && (r.kind === 'read' || r.kind === 'session') && r.broker !== 'kotak') { reads.add(r.broker); continue; }
      keep.push(s);
    }
    return { keep, reads: [...reads] };
  }

  async function review(args) {
    const name = ACTIONS[args.action];
    if (!name) return { text: `Unknown action ${args.action}` };
    const a = { ...args, folder };
    delete a.action;
    // Lists sometimes arrive as JSON text; take them either way.
    for (const k of ['findings', 'corporate_actions']) if (typeof a[k] === 'string') { try { a[k] = JSON.parse(a[k]); } catch { /* left as is; the engine rejects it */ } }
    // A new run starts from a fresh pull of every broker the engine can read.
    if (args.action === 'start') await collect.runAll(folder, { brokers: enabled(), deps, ctx });
    let r = await callTool(name, a, ctx);
    // Reads the engine can make itself are made here, then the run goes on: the model never carries them.
    for (let i = 0; i < 3 && r.ok !== false; i++) {
      const f = await filterNext(r.next);
      if (!f.reads.length) { r = { ...r, next: f.keep }; break; }
      await collect.runAll(folder, { brokers: f.reads, deps, ctx });
      r = await callTool('review_next', { folder, run: r.run }, ctx);
    }
    // One text block of at most 2 KB: the summary, then as many next steps as fit. The run hands
    // out the rest once these are done, so nothing is lost.
    const steps = r.next || [];
    const fit = [];
    let room = MAX_TEXT - 700;
    for (const st of steps) {
      const b = Buffer.byteLength(JSON.stringify(st));
      if (fit.length && b > room) break;
      fit.push(st);
      room -= b;
    }
    const more = steps.length - fit.length;
    const tail = fit.length ? `
Next (do these, then call portfolio_review action next${more ? `; ${more} more after these` : ''}):
${JSON.stringify(fit)}` : '';
    const body = clip(r.text).slice(0, Math.max(300, MAX_TEXT - Buffer.byteLength(tail) - 20));
    return { text: clip(body + tail), next: fit, more, stage: r.stage, run: r.run, gate: r.gate };
  }

  async function status(args) {
    if (args.login && args.login.broker) {
      const l = await collect.login(args.login.broker, args.login, deps);
      if (l.state !== 'ready') return { text: `${args.login.broker}: ${l.detail}` };
    }
    const all = await collect.status(deps);
    const on = enabled();
    const st = Object.fromEntries(Object.entries(all).filter(([b]) => on.includes(b)));
    const lines = Object.entries(st).map(([b, s]) => `${b}: ${s.state}${s.detail ? `, ${s.detail}` : ''}`);
    const manual = Object.entries(st).filter(([, s]) => s.state === 'needs_login' && s.login).map(([b, s]) => `- ${b}: ${s.login.url ? `${s.login.url} · ` : ''}${s.login.steps.join('; ')}`);
    if (!manual.length) lines.push(Object.values(st).every((s) => s.state === 'ready' || s.state === 'chat') ? 'All connected (Kotak through chat)' : '');
    else lines.push('Needs you, all at once:', ...manual);
    return { text: clip(lines.filter(Boolean).join('\n')) };
  }

  async function refresh(args) {
    const r = await collect.runAll(folder, { brokers: args.brokers, deps, ctx });
    const head = String(r.refresh.text).split('\n').slice(0, 6).join('\n');
    const attention = section(r.refresh.text, 'Needs attention');
    const pulled = Object.entries(r.brokers).map(([b, s]) => `${b}: ${s.state}${s.errors && s.errors.length ? ` (${s.errors.join('; ')})` : ''}`).join(' · ');
    return { text: clip([pulled, head, attention, r.ibkr ? r.ibkr.text : ''].filter(Boolean).join('\n')) };
  }

  async function query({ q = '' }) {
    const [what, arg] = q.trim().split(/\s+/);
    const sym = arg ? arg.toUpperCase() : null;
    if (what === 'decisions') return { text: clip((await callTool('decisions', { folder }, ctx)).text) };
    if (what === 'journal') return { text: clip((await callTool('journal_readback', { folder, older_than_days: 0 }, ctx)).text) };
    if (what === 'export') return { text: clip((await callTool('export', { folder, format: 'dashboard' }, ctx)).text) };
    const check = (await callTool('check', { folder }, ctx)).text;
    if (what === 'allocation') return { text: clip(section(check, 'Allocation') || 'No allocation table in the check.') };
    if (what === 'guardrails') return { text: clip(section(check, 'Guardrails')) };
    if (what === 'gtt' && sym) {
      const a = (await callTool('gtt_audit', { folder }, ctx)).text;
      return { text: clip(a.split('\n').filter((l) => l.includes(sym)).join('\n') || `${sym}: no GTT finding; nothing to change.`) };
    }
    if (what === 'holding' && sym) {
      const lines = check.split('\n').filter((l) => l.includes(sym));
      return { text: clip(lines.join('\n') || `${sym} is not in the latest snapshot.`) };
    }
    return { text: 'q: holding <SYM> | allocation | guardrails | gtt <SYM> | journal | decisions | export' };
  }

  const handlers = { portfolio_status: status, portfolio_refresh: refresh, portfolio_review: review, portfolio_query: query };

  async function call(name, args = {}) {
    const h = handlers[name];
    // Only the four tools exist: no broker tool, read or write, can be called through this server.
    if (!h) return { isError: true, content: [{ type: 'text', text: `Unknown tool ${name}. This server has no broker or order tools.` }] };
    try {
      const r = await h(args);
      return { content: [{ type: 'text', text: r.text }], structuredContent: r };
    } catch (e) {
      return { isError: true, content: [{ type: 'text', text: `Error: ${e.message}` }] };
    }
  }

  async function handle(msg) {
    if (msg.id === undefined) return null;
    const ok = (result) => ({ jsonrpc: '2.0', id: msg.id, result });
    if (msg.method === 'initialize') return ok({ protocolVersion: (msg.params && msg.params.protocolVersion) || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'portfolio-copilot-local', version: require('../core/lib/version').manifest().version } });
    if (msg.method === 'tools/list') return ok({ tools: TOOLS });
    if (msg.method === 'tools/call') {
      // Only the text goes to the model (at most 2 KB); the structured copy is for tests.
      const r = await call(msg.params && msg.params.name, (msg.params && msg.params.arguments) || {});
      return ok({ content: r.content, ...(r.isError ? { isError: true } : {}) });
    }
    if (msg.method === 'ping') return ok({});
    return { jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `unknown method ${msg.method}` } };
  }

  return { TOOLS, call, handle };
}

function main() {
  const i = process.argv.indexOf('--folder');
  const folder = i > 0 ? process.argv[i + 1] : process.env.PORTFOLIO_COPILOT_HOME;
  if (!folder) { console.error('Usage: node local/server.js --folder <investor folder>'); process.exit(1); }
  // Evals only: --fake-collectors <json> serves fixture broker data instead of real brokers.
  const k = process.argv.indexOf('--fake-collectors');
  let deps = {};
  if (k > 0) {
    const data = JSON.parse(require('fs').readFileSync(process.argv[k + 1], 'utf8'));
    const fake = require('./collectors/fake');
    deps = { collectors: { kite: fake({ broker: 'kite', data: data.kite || {} }), kotak: require('./collectors/kotak')(), ibkr: fake({ broker: 'ibkr', state: 'needs_login' }) } };
  }
  const server = makeServer({ folder, deps });
  readline.createInterface({ input: process.stdin }).on('line', async (line) => {
    let msg;
    try { msg = JSON.parse(line); } catch { return; }
    const res = await server.handle(msg);
    if (res) process.stdout.write(JSON.stringify(res) + '\n');
  });
}

if (require.main === module) main();
module.exports = { makeServer, TOOLS, MAX_TEXT };
