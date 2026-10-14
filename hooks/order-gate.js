#!/usr/bin/env node
'use strict';
// PreToolUse: deterministic order gate. Allows an order-capable call only when it matches an
// investor-approved draft. No model judgment. Any internal error denies (fail closed).

const drafts = require('../core/lib/drafts');
const { readStdin, candidateFolders } = require('./lib');

const ORDER_RE = /(place|modify|delete|cancel)_(gtt_)?order$/;
const EPS = 0.01;

function near(a, b) {
  return a !== undefined && b !== undefined && a !== null && b !== null && Math.abs(Number(a) - Number(b)) <= EPS;
}

function sameGtt(input, args) {
  if (String(input.tradingsymbol || '').toUpperCase() !== String(args.tradingsymbol).toUpperCase()) return false;
  if ((input.transaction_type || 'SELL') !== args.transaction_type) return false;
  if ((input.trigger_type || 'single') !== args.trigger_type) return false;
  if (args.trigger_type === 'two-leg') {
    return ['lower_trigger_value', 'lower_quantity', 'lower_limit_price', 'upper_trigger_value', 'upper_quantity', 'upper_limit_price'].every((k) => near(input[k], args[k]));
  }
  return ['trigger_value', 'quantity', 'limit_price'].every((k) => near(input[k], args[k]));
}

function sameBasketOrder(input, row) {
  return String(input.tradingsymbol || '').toUpperCase() === row.symbol
    && input.transaction_type === 'BUY'
    && near(input.quantity, row.qty)
    && (input.order_type === 'LIMIT' && near(input.price, row.limit_price));
}

function decide(input, folders, now = new Date()) {
  const tool = String(input.tool_name || '');
  const args = input.tool_input || {};

  if (/execute_draft$/.test(tool)) {
    const code = String(args.code || '').toUpperCase();
    for (const f of folders) {
      const v = drafts.verify(f, code, now);
      if (v.ok) return { allow: true };
    }
    return { allow: false, reason: `Draft ${code || '(none)'} is not approved by the investor. Show the draft and ask them to type "approve ${code || '<code>'}".` };
  }

  if (!ORDER_RE.test(tool)) return { allow: true };

  const approved = folders.flatMap((f) => drafts.approvedDrafts(f, now));
  const kind = tool.match(ORDER_RE);
  const op = kind[1];
  const isGtt = !!kind[2];
  if (isGtt && op === 'place' && approved.some((d) => d.kind === 'gtt_plan' && d.rows.some((r) => r.action === 'place' && sameGtt(args, r.args)))) return { allow: true };
  if (isGtt && op === 'delete' && approved.some((d) => d.kind === 'gtt_plan' && d.rows.some((r) => r.action === 'delete' && String(r.gtt_id) === String(args.trigger_id)))) return { allow: true };
  if (!isGtt && op === 'place' && approved.some((d) => d.kind === 'basket' && d.rows.some((r) => sameBasketOrder(args, r)))) return { allow: true };
  return {
    allow: false,
    reason: `Blocked ${tool}: it does not match any draft the investor approved. Create a draft (draft_gtt_plan / draft_basket), show it, and wait for "approve <code>". Modify and cancel are not drafted: use place-then-delete.`,
  };
}

if (require.main === module) {
  readStdin().then((raw) => {
    let d;
    try {
      const input = JSON.parse(raw || '{}');
      d = decide(input, candidateFolders(input));
    } catch (e) {
      d = { allow: false, reason: `Order gate error (${e.message}); failing closed.` };
    }
    if (!d.allow) {
      process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: d.reason } }));
    }
    // Allowed: print nothing, so normal permission prompts still apply.
  });
}

module.exports = { decide, ORDER_RE };
