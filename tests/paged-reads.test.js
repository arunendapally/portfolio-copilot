'use strict';
// Issue #31: a paged get_gtts (limit=1) was taken as the full list, and the stale message named
// every read instead of the one that is old or partial.
const test = require('node:test');
const assert = require('node:assert');
const { tmpEnv, fixture } = require('./helpers');
const capture = require('../hooks/capture');
const inputs = require('../core/lib/inputs');

const T0 = new Date('2026-11-06T05:00:00Z');
const at = (min) => new Date(T0.getTime() + min * 60000);
const profile = fixture('profile.json');

// What Claude Code hands the hook after a Kite MCP read, with the arguments the model used.
function read(tool, payload, now, tool_input = {}) {
  return capture.run({ tool_name: `mcp__kite__${tool}`, tool_input, tool_response: { content: [{ type: 'text', text: JSON.stringify(payload) }] } }, now);
}

function readAll(now, book = fixture('kite-book.json'), gttInput = {}) {
  read('get_holdings', book.holdings, now);
  read('get_margins', book.margins, now);
  read('get_gtts', book.gtts, now, gttInput);
}

test('a read made with limit or from is partial: it is reported by name, not taken as the full list', () => {
  tmpEnv();
  const book = fixture('kite-book.json');
  read('get_holdings', book.holdings, T0);
  read('get_margins', book.margins, T0);
  read('get_gtts', book.gtts.slice(0, 1), T0, { limit: 1 });
  const r = inputs.pull('kite', profile, T0);
  assert.strictEqual(r.status, 'stale');
  assert.match(r.detail, /get_gtts/);
  assert.match(r.detail, /limit/);
  assert.doesNotMatch(r.detail, /get_holdings|get_margins/);
  read('get_gtts', book.gtts, T0); // the full read clears it
  assert.strictEqual(inputs.pull('kite', profile, T0).status, 'live');
});

test('a later page (from above 0) is partial too', () => {
  tmpEnv();
  readAll(T0, fixture('kite-book.json'), { from: 5 });
  const r = inputs.pull('kite', profile, T0);
  assert.strictEqual(r.status, 'stale');
  assert.match(r.detail, /get_gtts was read with from=5/);
});

test('reads made with no paging stay live: no arguments, from 0, limit null or 0', () => {
  for (const gttInput of [{}, { from: 0 }, { limit: null }, { limit: 0 }, { from: 0, limit: null }]) {
    tmpEnv();
    readAll(T0, fixture('kite-book.json'), gttInput);
    assert.strictEqual(inputs.pull('kite', profile, T0).status, 'live', JSON.stringify(gttInput));
  }
});

test('a paged optional read (funds, orders) is reported too, not merged in as the full list', () => {
  tmpEnv();
  const book = fixture('kite-book.json');
  readAll(T0, book);
  read('get_mf_holdings', book.mf, T0, { limit: 1 });
  const r = inputs.pull('kite', profile, T0);
  assert.strictEqual(r.status, 'stale');
  assert.match(r.detail, /get_mf_holdings was read with limit=1/);
  read('get_orders', book.orders, T0, { from: 3 });
  assert.match(inputs.pull('kite', profile, T0).detail, /get_orders was read with from=3/);
  read('get_mf_holdings', book.mf, T0);
  read('get_orders', book.orders, T0);
  assert.strictEqual(inputs.pull('kite', profile, T0).status, 'live');
});

test('a failed paged read is an outage, not a partial read', () => {
  tmpEnv();
  const book = fixture('kite-book.json');
  read('get_holdings', book.holdings, T0);
  read('get_margins', book.margins, T0);
  capture.run({ hook_event_name: 'PostToolUseFailure', tool_name: 'mcp__kite__get_gtts', tool_input: { limit: 1 }, error: 'upstream 502 bad gateway' }, T0);
  assert.strictEqual(inputs.pull('kite', profile, T0).status, 'outage');
});

test('the stale message names only the reads that are old', () => {
  tmpEnv();
  const book = fixture('kite-book.json');
  readAll(T0, book);
  read('get_holdings', book.holdings, at(40));
  read('get_margins', book.margins, at(40));
  const r = inputs.pull('kite', profile, at(45));
  assert.strictEqual(r.status, 'stale');
  assert.match(r.detail, /older than 30 min/);
  assert.match(r.detail, /get_gtts/);
  assert.doesNotMatch(r.detail, /get_holdings|get_margins/);
});
