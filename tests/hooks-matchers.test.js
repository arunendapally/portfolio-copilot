'use strict';
// Spec 002, US1: hook matchers name brokers, not verbs, so every tool of a broker reaches the
// scripts, which decide by the tool map (contracts/hooks.md).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { fixture } = require('./helpers');

const H = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'hooks', 'hooks.json'), 'utf8')).hooks;
const T = fixture('toolnames.json');
const byScript = (ev, script) => (H[ev] || []).find((g) => g.hooks.some((x) => x.command.includes(script)));
const re = (g) => new RegExp(g.matcher);

const NOT_BROKER = ['Bash', 'Read', 'mcp__claude_ai_Gmail__list_drafts', 'mcp__Todoist__add-tasks', 'mcp__claude-artifacts__db_write'];

test('the order gate sees every broker tool under every prefix, and AskUserQuestion', () => {
  const m = re(byScript('PreToolUse', 'order-gate.js'));
  for (const row of T.tools) for (const p of T.prefixes[row.broker]) assert.ok(m.test(p + row.tool), `not gated: ${p}${row.tool}`);
  assert.ok(m.test('AskUserQuestion'));
  for (const n of ['mcp__kite__teleport', 'mcp__ibkr__transfer_funds']) assert.ok(m.test(n), `made-up broker tool must reach the gate: ${n}`);
  for (const n of NOT_BROKER) assert.ok(!m.test(n), `gated by mistake: ${n}`);
});

test('capture sees every broker tool on success and on failure, with the same matcher', () => {
  const ok = byScript('PostToolUse', 'capture.js');
  const fail = byScript('PostToolUseFailure', 'capture.js');
  assert.ok(ok && fail);
  assert.strictEqual(ok.matcher, fail.matcher);
  for (const row of T.tools) for (const p of T.prefixes[row.broker]) assert.ok(re(ok).test(p + row.tool), `not captured: ${p}${row.tool}`);
  for (const n of NOT_BROKER) assert.ok(!re(ok).test(n), `captured by mistake: ${n}`);
});

test('the matcher contains no verb, so a rename cannot slip past it', () => {
  for (const g of [byScript('PreToolUse', 'order-gate.js'), byScript('PostToolUse', 'capture.js')]) {
    assert.doesNotMatch(g.matcher, /place|modify|delete|cancel|get_|list_/, g.matcher);
  }
});
