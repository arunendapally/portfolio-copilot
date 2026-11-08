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
  assert.strictEqual(inputs.pull('kite', profile, T0).status, 'stale');
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
