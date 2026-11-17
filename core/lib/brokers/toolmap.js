'use strict';
// The one place broker MCP tool names live (spec 002, contracts/broker-tools.md).
// Everything else asks this map by capability: the order gate, capture, inputs, drafts, doctor.
// When a broker renames its tools, this file and tests/fixtures/toolnames.json change; nothing else.

const BROKERS = {
  kite: { order_capable: true, server: /kite|zerodha/i, mcp: 'Kite' },
  kotak: { order_capable: false, server: /kotak/i, mcp: 'Kotak Neo' },
  ibkr: { order_capable: true, server: /interactive_brokers|ibkr/i, mcp: 'Interactive Brokers' },
};

// [broker, generation, tool, mode, kind, cap]. Kite generation 2 (from 11-Nov-2026) groups
// tools and picks the action by `mode`; generation 1 is one tool per action.
const ROWS = [
  ['kite', 2, 'session', 'status', 'session', 'session'],
  ['kite', 2, 'session', 'login', 'session', 'session'],
  ['kite', 2, 'session', 'logout', 'session', 'session'],
  ['kite', 2, 'portfolio', 'profile', 'read', 'profile'],
  ['kite', 2, 'portfolio', 'margins', 'read', 'margins'],
  ['kite', 2, 'portfolio', 'holdings', 'read', 'holdings'],
  ['kite', 2, 'portfolio', 'positions', 'read', 'positions'],
  ['kite', 2, 'mutual_funds', 'holdings', 'read', 'mf'],
  ['kite', 2, 'gtt', 'list', 'read', 'gtts'],
  ['kite', 2, 'gtt', 'place', 'write', 'gtt_write'],
  ['kite', 2, 'gtt', 'modify', 'write', 'gtt_write'],
  ['kite', 2, 'gtt', 'delete', 'write', 'gtt_write'],
  ['kite', 2, 'orders', 'list', 'read', 'orders'],
  ['kite', 2, 'orders', 'all_trades', 'read', 'trades'],
  ['kite', 2, 'orders', 'history', 'read', 'order_detail'],
  ['kite', 2, 'orders', 'trades', 'read', 'order_detail'],
  ['kite', 2, 'orders', 'approval_status', 'read', 'order_approval'],
  ['kite', 2, 'orders', 'place', 'write', 'order_write'],
  ['kite', 2, 'orders', 'modify', 'write', 'order_write'],
  ['kite', 2, 'orders', 'cancel', 'write', 'order_write'],
  ['kite', 2, 'orders', 'permissions', 'write', 'order_write'],
  ['kite', 2, 'market', 'ltp', 'read', 'ltp'],
  ['kite', 2, 'market', 'quote', 'read', 'market'],
  ['kite', 2, 'market', 'ohlc', 'read', 'market'],
  ['kite', 2, 'market', 'search', 'read', 'market'],
  ['kite', 2, 'market', 'option_chain', 'read', 'market'],
  ['kite', 2, 'market', 'historical', 'read', 'history'],
  ['kite', 2, 'alerts', 'list', 'read', 'other'],
  ['kite', 2, 'help', null, 'read', 'other'],
  ['kite', 2, 'open_kite_view', null, 'read', 'other'],
  ['kite', 1, 'login', null, 'session', 'session'],
  ['kite', 1, 'get_profile', null, 'read', 'profile'],
  ['kite', 1, 'get_holdings', null, 'read', 'holdings'],
  ['kite', 1, 'get_mf_holdings', null, 'read', 'mf'],
  ['kite', 1, 'get_gtts', null, 'read', 'gtts'],
  ['kite', 1, 'get_margins', null, 'read', 'margins'],
  ['kite', 1, 'get_positions', null, 'read', 'positions'],
  ['kite', 1, 'get_orders', null, 'read', 'orders'],
  ['kite', 1, 'get_trades', null, 'read', 'trades'],
  ['kite', 1, 'get_order_history', null, 'read', 'order_detail'],
  ['kite', 1, 'get_order_trades', null, 'read', 'order_detail'],
  ['kite', 1, 'get_ltp', null, 'read', 'ltp'],
  ['kite', 1, 'get_ohlc', null, 'read', 'market'],
  ['kite', 1, 'get_quotes', null, 'read', 'market'],
  ['kite', 1, 'search_instruments', null, 'read', 'market'],
  ['kite', 1, 'get_historical_data', null, 'read', 'history'],
  ['kite', 1, 'place_gtt_order', null, 'write', 'gtt_write'],
  ['kite', 1, 'modify_gtt_order', null, 'write', 'gtt_write'],
  ['kite', 1, 'delete_gtt_order', null, 'write', 'gtt_write'],
  ['kite', 1, 'place_order', null, 'write', 'order_write'],
  ['kite', 1, 'modify_order', null, 'write', 'order_write'],
  ['kite', 1, 'cancel_order', null, 'write', 'order_write'],
  ['kotak', 1, 'get_login', null, 'session', 'session'],
  ['kotak', 1, 'validate_login', null, 'session', 'session'],
  ['kotak', 1, 'get_logout', null, 'session', 'session'],
  ['kotak', 1, 'get_holdings', null, 'read', 'holdings'],
  ['kotak', 1, 'get_limits', null, 'read', 'margins'],
  ['kotak', 1, 'get_margin', null, 'read', 'other'],
  ['kotak', 1, 'get_positions', null, 'read', 'positions'],
  ['kotak', 1, 'get_order_book', null, 'read', 'orders'],
  ['kotak', 1, 'get_order_history', null, 'read', 'order_detail'],
  ['kotak', 1, 'get_trade_book', null, 'read', 'trades'],
  ['kotak', 1, 'get_quote', null, 'read', 'market'],
  ['kotak', 1, 'get_research', null, 'read', 'market'],
  ['kotak', 1, 'search_instrument', null, 'read', 'market'],
  ['ibkr', 1, 'get_account_positions', null, 'read', 'holdings'],
  ['ibkr', 1, 'get_account_balances', null, 'read', 'balances'],
  ['ibkr', 1, 'get_account_summary', null, 'read', 'summary'],
  ['ibkr', 1, 'get_account_orders', null, 'read', 'orders'],
  ['ibkr', 1, 'get_account_trades', null, 'read', 'trades'],
  ['ibkr', 1, 'get_order_instructions', null, 'read', 'order_detail'],
  ['ibkr', 1, 'create_order_instruction', null, 'write', 'order_write'],
  ['ibkr', 1, 'delete_order_instruction', null, 'write', 'order_write'],
].map(([broker, generation, tool, mode, kind, cap]) => ({ broker, generation, tool, mode, kind, cap }));

// Write calls per broker, generation, capability and operation.
const WRITES = {
  kite: {
    1: { gtt_write: { place: 'place_gtt_order', modify: 'modify_gtt_order', delete: 'delete_gtt_order' }, order_write: { place: 'place_order', modify: 'modify_order', cancel: 'cancel_order' } },
    2: { gtt_write: 'gtt', order_write: 'orders' },
  },
  ibkr: { 1: { order_write: { place: 'create_order_instruction', cancel: 'delete_order_instruction', delete: 'delete_order_instruction' } } },
};

// Full-list reads per broker and generation. Page size 500 so one call returns the whole list;
// capture still checks the pagination the broker returns.
const READS = {
  kite: {
    1: [['holdings', 'get_holdings', {}, true], ['gtts', 'get_gtts', {}, true], ['margins', 'get_margins', {}, true], ['mf', 'get_mf_holdings', {}, false], ['orders', 'get_orders', {}, false]],
    2: [
      ['holdings', 'portfolio', { mode: 'holdings', type: 'full', limit: 500 }, true],
      ['gtts', 'gtt', { mode: 'list', limit: 500 }, true],
      ['margins', 'portfolio', { mode: 'margins' }, true],
      ['mf', 'mutual_funds', { mode: 'holdings' }, false],
      ['orders', 'orders', { mode: 'list', limit: 500 }, false],
    ],
  },
  kotak: { 1: [['holdings', 'get_holdings', {}, true], ['margins', 'get_limits', {}, true]] },
  ibkr: { 1: [['holdings', 'get_account_positions', {}, true], ['balances', 'get_account_balances', {}, true], ['summary', 'get_account_summary', {}, false]] },
};
// Session check and login start per broker and generation (connect).
const SESSION = { kite: { 2: ['session', { mode: 'status' }] } };
const LOGIN = { kotak: { 1: ['get_login', {}] } };
function sessionCall(broker, gen) { const e = (SESSION[broker] || {})[gen]; return e ? { tool: e[0], args: { ...e[1] } } : null; }
function loginCall(broker, gen = 1) { const e = (LOGIN[broker] || {})[gen]; return e ? { tool: e[0], args: { ...e[1] } } : null; }

const LTP = { kite: { 1: ['get_ltp', {}], 2: ['market', { mode: 'ltp' }] } };

const GROUPED = new Set(ROWS.filter((r) => r.mode).map((r) => `${r.broker}:${r.tool}`));
const ORDERISH = /(place|modify|cancel|submit|create|delete|amend).*order|order.*(place|modify|cancel|submit|create|delete|amend)/i;

function split(name) {
  const parts = String(name).split('__');
  if (parts[0] === 'mcp' && parts.length >= 3) return { server: parts.slice(1, -1).join('__'), tool: parts[parts.length - 1], bare: false };
  return { server: '', tool: parts[parts.length - 1], bare: parts.length === 1 };
}

function brokerOf(server, tool, bare) {
  for (const [b, def] of Object.entries(BROKERS)) if (server && def.server.test(server)) return b;
  if (!bare) return null;
  const owners = [...new Set(ROWS.filter((r) => r.tool === tool).map((r) => r.broker))];
  return owners.length === 1 ? owners[0] : null;
}

// IBKR exposes many research tools; read-only by shape, with anything order-like unknown.
function ibkrPattern(tool) {
  if (ORDERISH.test(tool)) return null;
  if (/^(get_|search_|list_|preview_|run_)|^whats_new$/.test(tool)) return { kind: 'read', cap: 'market' };
  if (/alert|watchlist|screener|feedback/.test(tool)) return { kind: 'read', cap: 'other' };
  return null;
}

function known(broker, tool) {
  return ROWS.some((r) => r.broker === broker && r.tool === tool) || (broker === 'ibkr' && !!ibkrPattern(tool));
}

function resolve(name, input = {}) {
  const { server, tool, bare } = split(name);
  const broker = brokerOf(server, tool, bare);
  const mode = input && typeof input.mode === 'string' ? input.mode : null;
  if (!broker) return { broker: null, tool, mode, kind: 'none', cap: null, order_capable: false, generation: null, looks_write: false };
  const def = BROKERS[broker];
  const base = { broker, tool, mode, order_capable: def.order_capable, looks_write: ORDERISH.test(tool) };
  const grouped = GROUPED.has(`${broker}:${tool}`);
  const row = ROWS.find((r) => r.broker === broker && r.tool === tool && (!grouped || r.mode === mode));
  if (row) return { ...base, kind: row.kind, cap: row.cap, generation: row.generation };
  const pat = broker === 'ibkr' ? ibkrPattern(tool) : null;
  if (pat) return { ...base, ...pat, generation: 1 };
  const gen = ROWS.find((r) => r.broker === broker && r.tool === tool);
  return { ...base, kind: 'unknown', cap: null, generation: gen ? gen.generation : null };
}

function writeCall(broker, cap, op, args = {}, gen = 2) {
  const byGen = WRITES[broker];
  if (!byGen) throw new Error(`${broker} has no write path: portfolio-copilot never sends orders there`);
  const g = byGen[gen] || byGen[1];
  const entry = g[cap];
  if (!entry) throw new Error(`${broker} has no write for ${cap}`);
  if (typeof entry === 'string') return { tool: entry, args: { mode: op, ...args } };
  if (!entry[op]) throw new Error(`${broker} has no write for ${cap} ${op}`);
  return { tool: entry[op], args: { ...args } };
}

function readCalls(broker, gen = 2) {
  const byGen = READS[broker] || {};
  const list = byGen[gen] || byGen[1] || [];
  return list.map(([cap, tool, args, required]) => ({ cap, tool, args: { ...args }, required }));
}

function ltpCall(broker, gen, instruments) {
  const byGen = LTP[broker];
  if (!byGen) return null;
  const [tool, args] = byGen[gen] || byGen[2];
  return { tool, args: { ...args, instruments } };
}

// Which Kite generation the session has, from the tool names seen. Newest when nothing is known.
function generation(broker, names) {
  const gens = new Set((names || []).map((n) => resolve(n, {})).filter((r) => r.broker === broker).map((r) => {
    const row = ROWS.find((x) => x.broker === broker && x.tool === r.tool);
    return row ? row.generation : null;
  }).filter(Boolean));
  if (gens.has(2)) return 2;
  if (gens.has(1)) return 1;
  const all = ROWS.filter((r) => r.broker === broker).map((r) => r.generation);
  return all.length ? Math.max(...all) : 1;
}

// A call written for people: tool plus its arguments.
function show(call) {
  const args = call.args && Object.keys(call.args).length ? ` ${JSON.stringify(call.args)}` : '';
  return `${call.tool}${args}`;
}

// Per enabled broker: can it read, can it write, which tools are unknown, and the exact calls.
function doctor(present, profile) {
  const names = present || [];
  const enabled = Object.entries((profile && profile.brokers) || {}).filter(([b, v]) => BROKERS[b] && v && v.enabled).map(([b]) => b);
  return enabled.map((broker) => {
    const mine = names.filter((n) => resolve(n, {}).broker === broker);
    const tools = new Set(mine.map((n) => split(n).tool));
    const gen = generation(broker, mine);
    const reads = readCalls(broker, gen);
    const missing = reads.filter((c) => c.required && !tools.has(c.tool)).map((c) => c.cap);
    let write_path = null;
    if (BROKERS[broker].order_capable && WRITES[broker]) {
      const g = WRITES[broker][gen] || WRITES[broker][1];
      const writeTools = Object.values(g).flatMap((e) => (typeof e === 'string' ? [e] : Object.values(e)));
      write_path = writeTools.some((t) => tools.has(t));
    }
    return {
      broker, mcp: BROKERS[broker].mcp, generation: gen,
      read_path: missing.length === 0 && mine.length > 0, write_path, missing,
      unknown: mine.filter((n) => !known(broker, split(n).tool)),
      calls: reads.map((c) => ({ ...c, text: show(c) })),
    };
  });
}

module.exports = { BROKERS, ROWS, resolve, writeCall, readCalls, sessionCall, loginCall, ltpCall, generation, doctor, show, known };
