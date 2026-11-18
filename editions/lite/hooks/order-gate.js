#!/usr/bin/env node
'use strict';
// PreToolUse: deterministic order gate for the brokers' own MCP tools. Every tool of a broker
// reaches this script; the tool map says what it is. A write passes only when its tool and
// arguments (mode included) match a row of a draft the investor approved, and each row passes
// once. A tool the map does not know is denied on brokers that can take orders. No model
// judgment. Any internal error denies (fail closed).

const drafts = require('../core/lib/drafts');
const toolmap = require('../core/lib/brokers/toolmap');
const gap = require('../core/lib/gap');
const { readStdin, candidateFolders } = require('./lib');

const EPS = 0.01;
// Informational fields: the live price moves, the tag is only a label, and the broker's own
// request id and approval method are added by its client.
const IGNORE = new Set(['last_price', 'tag', '_app_request_id', 'approval_method']);

function same(a, b) {
  if (a === undefined || a === null || a === '') return b === undefined || b === null || b === '';
  if (b === undefined || b === null || b === '') return false;
  // Nested objects and lists are compared field by field (an order inside an instruction).
  if (typeof a === 'object' || typeof b === 'object') {
    if (typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
    if (Array.isArray(a)) return a.length === b.length && a.every((x, i) => same(x, b[i]));
    return sameArgs(a, b);
  }
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
    // Review task questions carry the task id as header (spec 002 T057): their answers are decisions too.
    const isTask = (args.questions || []).some((q) => /^t_[0-9a-f]{6,}$/.test(String(q.header || '')));
    return answered && (offersYes || isTask) ? { allow: false, reason: 'Approval questions are answered by the investor in the question UI; never pre-fill answers.' } : { allow: true };
  }

  const r = toolmap.resolve(tool, args);
  if (!r.broker) return { allow: true };
  if (r.kind === 'unknown') {
    const what = `${r.tool}${r.mode ? ` mode ${r.mode}` : ''}`;
    // A write-like name is denied on every broker, read-only ones too: a new tool could be an order.
    if (r.order_capable || r.looks_write || /^(place|modify|cancel|delete|create|update|edit|add|remove|set|submit|execute|convert|exit)_/i.test(r.tool) || /^(place|modify|cancel|delete|create|update)$/i.test(r.mode || '')) {
      return { allow: false, reason: `Blocked ${tool}: portfolio-copilot does not know this ${r.broker} tool (${what}), so it cannot tell a read from an order. Nothing was sent. Run the doctor command for the calls to use now.` };
    }
    try { gap.queuePending({ title: `Unknown ${r.broker} tool: ${what}`, attempted: tool, missing: 'tool map entry' }, now); } catch { /* the queue is best effort */ }
    return { allow: true };
  }
  if (r.kind !== 'write') return { allow: true };
  if (opts.edition === 'lite') return { allow: false, reason: `Blocked ${tool}: the lite edition never places or changes orders. Draft the plan and enter it at the broker yourself.` };

  const name = r.tool;
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

module.exports = { decide, sameArgs };
