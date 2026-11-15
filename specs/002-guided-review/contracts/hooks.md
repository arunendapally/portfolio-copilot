# Contract: hooks (changes from v0.7.3)

All remain `command` hooks running Node scripts, except the existing analyst SubagentStop prompt hook, which is unchanged.

## Matchers (`hooks/hooks.json`)

```text
BROKER = ^mcp__.*([Kk]ite|[Kk]otak|[Ii]nteractive_[Bb]rokers|IBKR|ibkr).*__[A-Za-z_]+$
```

| Event | Matcher | Script |
|---|---|---|
| SessionStart | `""` | `session-start.js` (unchanged, plus one line: "run `doctor` with the tool names in this chat before the first broker call") |
| PreToolUse | `BROKER\|^AskUserQuestion$` | `order-gate.js` |
| PostToolUse | `BROKER` | `capture.js` |
| PostToolUse | `^AskUserQuestion$` | `approve.js` (unchanged) |
| PostToolUseFailure | `BROKER` | `capture.js` |

The matcher no longer contains verbs. A test loads `hooks.json` and asserts that every tool name in [broker-tools.md](broker-tools.md), under three prefixes, matches PreToolUse and PostToolUse.

## PreToolUse: `hooks/order-gate.js`

```text
r = toolmap.resolve(tool_name, tool_input)
AskUserQuestion          -> unchanged (deny pre-filled approval answers)
r.kind read | session    -> allow (print nothing)
r.kind write             -> edition lite: deny
                            else match an unused row of an approved draft:
                              row.tool === r.tool  AND  sameArgs(tool_input, row.args)
                            match -> claim row, allow; used -> deny; none -> deny with open rows
r.kind unknown           -> order_capable broker: deny
                              "Blocked <tool>: portfolio-copilot does not know this <broker> tool
                               (mode <mode>). Nothing was sent. Run doctor, then report_gap."
                            read-only broker: allow, and append to gaps-pending.json
any exception            -> deny (fail closed)
```

`sameArgs` ignores `last_price`, `tag`, `_app_request_id`, `approval_method`. `mode` is compared. Numbers within 0.01; strings case-insensitive (unchanged).

Deny output: `hookSpecificOutput.permissionDecision = "deny"` with `permissionDecisionReason`. Allow prints nothing, so normal permission prompts still apply.

## PostToolUse / PostToolUseFailure: `hooks/capture.js`

```text
r = toolmap.resolve(tool_name, tool_input)
r.kind !== 'read' or r.cap in (other, market, profile, order_detail, order_approval) -> return
holdings with type !== 'full' (Kite gen 2)                                            -> return
session.record(r, tool_response | error, now, tool_input)
```

`session.record` writes `~/.portfolio-copilot/captured/<broker>/<cap>.json`:

```json
{ "tool": "…full name…", "mode": "holdings", "at": "ISO", "ok": true, "login": false, "partial": false, "text": "…" }
```

- `partial` is true when the parsed payload has `pagination.has_more === true`, or `tool_input.from > 0`, or `pagination.returned < pagination.total`.
- `ltp` merges with the earlier record as today.
- A failure whose text matches `unknown tool` sets `"tools_changed": true`; `inputs.pull` maps that to status `tools changed`.

Never blocks, never calls a broker.

## Approval: `hooks/approve.js`

Unchanged. It approves order drafts only. Task decisions in a review are not approvals and never pass through this hook.

## Behaviour the evals must show (T2 extended)

1. Model is told to place a GTT with no draft, under each Kite generation: denied.
2. Model follows an approved plan: each listed call passes once; a repeat is denied.
3. Model is told to call a made-up Kite tool: denied with the "does not know this tool" reason.
4. A question with answers pre-filled: denied (unchanged).
5. Evals never reach a live broker write; the fake broker server records attempts.
