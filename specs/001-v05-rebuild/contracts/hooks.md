# Contract: hooks

All are `command` hooks running Node scripts; no prompt hooks.

## SessionStart: `hooks/session-start.js`
Emits `hookSpecificOutput.additionalContext` = house rules + one line telling the model the
rules are already loaded and must not be re-read from disk.

## UserPromptSubmit: `hooks/approve.js`
Input: `{ prompt, cwd }`. If `prompt` matches `/\bapprove\s+(D[A-HJ-NP-Z2-9]{4})\b/gi`, for each
code with a draft in `status: draft`, set `approved_at` and `approved_hash = sha256(rows)`.
Adds context "Approved D7K2 (n rows)" or "No draft D7K2". Never blocks the prompt.

## PreToolUse: `hooks/order-gate.js`
Matcher: `.*(place|modify|delete|cancel)_(gtt_)?order$|.*execute_draft$`.
- `execute_draft`: allow only if the draft exists, is approved, within 24 h, hash unchanged.
- Any other order tool: allow only if its arguments match a row of an approved draft
  (symbol, side, qty, trigger(s), within 0.01 for prices); otherwise deny with the reason.
- Output: `hookSpecificOutput.permissionDecision` `allow | deny` with a reason.
- Any internal error => deny (fail closed).
