#!/usr/bin/env node
'use strict';
// PreToolUse: deterministic order gate for the brokers' own MCP tools. A write call passes only
// when its arguments match a row of a draft the investor approved, and each row passes once.
// Tools are matched by name suffix, so mcp__kite__*, remote-device and hosted-connector prefixes
// all work. No model judgment. Any internal error denies (fail closed).

const drafts = require('../core/lib/drafts');
const { readStdin, candidateFolders } = require('./lib');

const WRITE_RE = /(^|__)((place|modify|delete|cancel|submit)_(gtt_)?order|create_order_instruction)$/;
const EPS = 0.01;
// Informational fields: the live price moves, the tag is only a label.
const IGNORE = new Set(['last_price', 'tag']);

function suffixOf(tool) {
  return String(tool).split('__').pop();
}

function same(a, b) {
  if (a === undefined || a === null || a === '') return b === undefined || b === null || b === '';
  if (b === undefined || b === null || b === '') return false;
  const na = Number(a);
  const nb = Number(b);
  if (typeof a !== 'object' && typeof b !== 'object' && Number.isFinite(na) && Number.isFinite(nb)) return Math.abs(na - nb) <= EPS;
  return String(a).toUpperCase() === String(b).toUpperCase();
}

// Every argument must agree, in both directions: an extra argument the draft did not show is a mismatch.
function sameArgs(input, rowArgs) {
  const keys = new Set([...Object.keys(input), ...Object.keys(rowArgs)]);
  for (const k of keys) if (!IGNORE.has(k) && !same(input[k], rowArgs[k])) return false;
  return true;
}

function decide(input, folders, now = new Date(), opts = {}) {
  const tool = String(input.tool_name || '');
  const args = input.tool_input || {};

  // Approvals come only from the investor's click; a question sent with its answers filled in is forged.
  if (tool === 'AskUserQuestion') {
    const answered = args.answers && typeof args.answers === 'object' && Object.keys(args.answers).length;
    const offersYes = (args.questions || []).some((q) => (q.options || []).some((o) => drafts.YES_RE.test(String(o.label))));
    return answered && offersYes ? { allow: false, reason: 'Approval questions are answered by the investor in the question UI; never pre-fill answers.' } : { allow: true };
  }

  if (!WRITE_RE.test(tool)) return { allow: true };
  if (opts.edition === 'lite') return { allow: false, reason: `Blocked ${tool}: the lite edition never places or changes orders. Draft the plan and enter it at the broker yourself.` };

  const name = suffixOf(tool);
  let usedBefore = null;
  const open = [];
  for (const f of folders) {
    for (const d of drafts.approvedDrafts(f, now)) {
      for (let i = 0; i < d.rows.length; i++) {
        const row = d.rows[i];
        if (row.tool !== name) continue;
        const label = `${d.code} step ${row.step || i + 1}`;
        if (!sameArgs(args, row.args || {})) {
          if (!drafts.rowUsed(f, d.code, i)) open.push(`${label}: ${name} ${JSON.stringify(row.args)}`);
        } else if (drafts.rowUsed(f, d.code, i)) usedBefore = label;
        else if (drafts.claimRow(f, d.code, i)) return { allow: true };
        else usedBefore = label;
      }
    }
  }
  if (usedBefore) return { allow: false, reason: `Blocked ${tool}: it matches ${usedBefore}, which was already used once. Each approved row runs one time.` };
  return {
    allow: false,
    reason: `Blocked ${tool}: its arguments do not match any row of a draft the investor approved. Create a draft (draft_gtt_plan / draft_basket / draft_orders), show it, and ask with the inline Yes/No question.${open.length ? ` Open approved rows: ${open.slice(0, 5).join(' | ')}` : ''}`,
  };
}

if (require.main === module) {
  readStdin().then((raw) => {
    let d;
    try {
      const input = JSON.parse(raw || '{}');
      d = decide(input, candidateFolders(input), new Date(), { edition: process.argv.includes('--edition=lite') ? 'lite' : 'full' });
    } catch (e) {
      d = { allow: false, reason: `Order gate error (${e.message}); failing closed.` };
    }
    if (!d.allow) {
      process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: d.reason } }));
    }
    // Allowed: print nothing, so normal permission prompts still apply.
  });
}

module.exports = { decide, WRITE_RE, sameArgs, suffixOf };
