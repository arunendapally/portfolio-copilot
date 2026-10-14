# portfolio-copilot: architecture review

14-Oct-2026. Scope: v0.4.1 repo plus three months of field evidence in the user's `feedback.md`. Companion to [v0.5.md](v0.5.md); where the two disagree, this document wins on architecture and v0.5.md on feature content.

## Verdict

The plugin works for one patient expert user and will not scale past that. The model is used as the database, the parser, the calculator and the session manager at once. Every run re-reads hundreds of KB of prose, pulls raw broker payloads into context, and recomputes the same arithmetic by hand. That makes it slow, expensive, nondeterministic, and fragile to any change in payload size or connector behaviour. Connectivity problems come mostly from how the plugin connects (deprecated transport through a local proxy, duplicate servers), not from the brokers.

The fix is not more skill prose. Move deterministic work into code, connect once and natively, and keep skills thin.

## Why it cannot scale

| # | Problem | Evidence | Effect |
|---|---|---|---|
| S1 | **All computation happens in the model's context.** GTT parsing, quantity diffs, P&L, crash tests, percentages: all done by the LLM reading raw JSON. | `get_gtts` returns 64-72K chars for about 40 GTTs; spilled to file 7+ times; workarounds were grep, python one-liners, 4x paginated calls. | Cost and latency grow linearly with holdings. Results differ between runs (₹84,505 vs ₹76,939 partly from different treatment of the same data). A user with 100 holdings breaks it. |
| S2 | **State is free-text markdown that only grows.** progress.md 160 KB, feedback.md 62 KB, CLAUDE.md 24 KB, FinancialHealthPlan.md 36 KB, all read at session start. | 14-Aug: missed a file because the list was hardcoded; denominators diverged (37% vs 45%) between documents. | Context fills before any work starts. No machine can diff markdown reliably. Every month makes every session slower. |
| S3 | **Logic is duplicated across skills.** GTT reduction rules appear in session-open, daily-briefing and gtt-audit with different wording; trade audit appears twice. | gtt-audit and crash-protocol contradicted the 30-Sep policy while CLAUDE.md had the right rule. | Fixes land in one place and not the others. Content drifts from the user's real rules. |
| S4 | **The real product lives in one user's personal CLAUDE.md**, not in the plugin. GTT policy, execution playbook, buffer location, war-chest table all sit outside the repo. | The plugin defaults conflict with the user's own file; the user's file wins only by luck of context. | A second user gets the stale defaults. Nothing in the plugin defines the per-user schema. |
| S5 | **Guardrails depend on an LLM judging an LLM.** The PreToolUse hook is a prompt hook (extra model call, 30 s timeout per order) and the SubagentStop audit never fired in evals. | 33 `place_gtt_order` calls on 30-Sep with no gate (plugin not loaded in cloud). | Safety is probabilistic and adds latency to every order. |
| S6 | **No tests in the repo, no CI.** Evals live in a personal folder; T1 and T3 fail since 22-Aug. | `plugin-tests-output.md`. | Regressions ship (hooks.json schema broke the whole plugin for 0.4.0 users). |

## Connectivity issues

| # | Issue | Likely cause | Fix |
|---|---|---|---|
| C1 | **Kite first call times out (-32001)**, 6+ runs. | `npx mcp-remote` cold start (npm resolve, Node spawn) plus SSE handshake on the first request. | Use native HTTP transport, no proxy: `"type": "http", "url": "https://mcp.kite.trade/mcp"`. Zerodha's README recommends `/mcp` over `/sse` "for better performance and reliability". |
| C2 | **Kite session drops minutes after login; login re-issues the same stale session_id; "Failed to execute" after a successful authorise** (24-Jul, 29-Jul, 14-Oct). | Hypothesis, to verify: the Kite token is bound to the MCP session. When the SSE stream drops, mcp-remote reconnects with a new or cached session and the binding is lost. | Same as C1 (streamable HTTP, no long-lived SSE stream). Then test: login, idle 10 min, call `get_holdings`. |
| C3 | **Two logins per session.** The plugin's `kite` and a standalone `kite` connector are separate servers with separate sessions. Duplicate tool sets confuse tool choice and hook matchers. | Plugin bundles a server the user may already have as a connector. | Ship one. Detect an existing Kite connector and use it; never run both. Skills reference tools by capability (`get_holdings` on whichever Kite server exists), not by a hardcoded server prefix. |
| C4 | **`delete_gtt_order` / `modify_gtt_order` reject every call** ("trigger_id is required"). | Connector-side. Zerodha's README states the hosted server excludes destructive trading operations, so this may be intentional rather than a bug. | Don't build on it. Plan for place-only plus a delete list the user executes in Kite web. Ask Zerodha which it is. |
| C5 | **Login gate is all-or-nothing** and once emitted a Kite URL that no tool returned (13-Aug). | Gate logic is prose in a skill. | Gate in code: probe each broker, return per-broker status, links only from tool output. |
| C6 | **Kotak QR binds to the session id of that run**; older ids fail without saying "superseded". Responses are delimited strings, not JSON. | Connector design. | One adapter that owns the Kotak session id and parses the CSV once. |
| C7 | **Kite token expires daily** (regulatory), so unattended scheduled runs nearly always hit the gate. | By design; not fixable. | Stop promising unattended Indian-market runs. Scheduled runs do macro + last snapshot + one login message; the full pull runs when the user logs in. |
| C8 | **Large payloads** exceed the tool-result cap. | Raw broker shapes go to the model. | Projection in code (see A2). |

## Target architecture

Three layers. Each does one thing.

```
Broker connectors (remote, native HTTP)      Kite /mcp, Kotak, IBKR: one of each, user-owned login
          │ raw tool results
          ▼
portfolio-core (local MCP server, Node, bundled)   normalize, project, compute, persist
          │ small typed results (a few KB)
          ▼
Skills (thin markdown)                       when to run, what to show, what to ask
```

**A1. Connectors.** Native `type: http` entries, no `npx mcp-remote`. Full edition bundles them only if no equivalent connector exists (README: "remove the connector or disable ours"). Lite edition bundles none.

**A2. portfolio-core**, a small Node MCP server in the plugin (Node is already a dependency for the hooks). The model stops doing arithmetic. Tools:

| Tool | Input | Output |
|---|---|---|
| `ingest` | raw tool result (or the spill-file path the client wrote) + broker name | normalized holdings / GTTs / orders in one schema, written to the state folder |
| `snapshot` | none | consolidated book: per-broker totals, weights with denominators, cash, diff vs last snapshot (new, exited, qty changed) |
| `gtt_audit` | policy from profile | per-symbol rows: qty gap, inverse gap, missing, policy violations, crash test at -10/-20%, proximity vs live LTP |
| `trade_audit` | today's orders + verdicts | contradictions (verdict, buffer, caps), GTT vs manual fill |
| `draft_gtt_plan` / `draft_basket` | targets | place/delete table; basket rows with LIMIT price and total |
| `broker_status` | probe results | per-broker live / login / outage, with the link only if a tool returned it |

Every number the model shows comes from one of these outputs. That makes house rule 3 ("no number from memory") mechanically true instead of aspirational.

**A3. State as data, not prose.** One state folder per user:
- `profile.json` (thresholds, GTT policy overrides, buffer location, allocation targets, war-chest table, verdicts). Schema versioned and validated by core.
- `snapshots/YYYY-MM-DD.json`, last 30 kept.
- `log.md`: a short "Start here" block plus dated entries, rotated monthly into `log/YYYY-MM.md`. Skills read only "Start here" and the latest month.

Markdown stays for what humans write (verdict reasoning, learnings), not for numbers.

**A4. Skills shrink and merge.** 10 skills to about 6: `get-started`, `check` (session-open + daily-briefing + eod, by time of day), `gtt` (audit + plan), `risk` (risk-check + mf-review + rebalance), `crash`, `analyze` (spawns the agent). Each skill states the flow and calls core; no duplicated parsing rules. Target under 40 lines each.

**A5. Guardrails in code where possible.** PreToolUse becomes a `command` hook: core keeps a list of drafted orders the user approved (written by a `confirm` step), and the hook allows only a tool call whose symbol/qty/trigger exactly matches an approved draft. That is deterministic, fast, and works without a model call. Keep the prompt hook only as a fallback for orders with no draft. House rules stay in SessionStart but shrink to the rules code cannot enforce.

## Instructions to the developer

Priority order. Each item has a check.

1. **Switch Kite to native streamable HTTP.** `.mcp.json`: `{"type":"http","url":"https://mcp.kite.trade/mcp"}`; same for Kotak if it supports it. Remove `npx mcp-remote`. *Check:* 10 cold starts with no -32001; login survives 15 minutes idle.
2. **One server per broker.** Detect an existing Kite/Kotak connector; skills address tools by capability; the hook matcher is `mcp__.*__(place|modify|delete|cancel)_(gtt_)?order$`. *Check:* unit test of the matcher against every tool name in feedback.md; one login per session.
3. **Build portfolio-core** with `ingest`, `snapshot`, `gtt_audit`, `broker_status` first. Node, no dependencies beyond the MCP SDK, unit tests on recorded payloads (scrubbed). *Check:* GTT audit on a 40-GTT book uses under 5 KB of context and gives the same answer twice.
4. **Move state to `profile.json` + snapshots + rotated log**; get-started writes them; a migration script imports the existing markdown profile. *Check:* session start reads under 20 KB.
5. **Merge skills to about 6 and remove duplicated rules**; encode the 30-Sep GTT policy once, in core, with profile overrides. *Check:* T9 grep finds no "trail" or "stop on every holding" text; crash test runs in every GTT audit.
6. **Deterministic order gate** (A5). *Check:* T2 blocks an unapproved `place_gtt_order` and allows an approved one, against a stub MCP, with no model call.
7. **Evals and CI in the repo.** validate --strict, matcher test, core unit tests on every PR; T0-T3 on release tags. *Check:* green CI is required before any upload to claude.ai.
8. **Stop designing for unattended Indian-market runs.** Scheduled run = macro + last snapshot + per-broker login message. *Check:* scheduled output never asks for the same broker login twice and never shows a constructed URL.
9. **Raise with Zerodha:** whether `delete/modify_gtt_order` are intentionally disabled on hosted, session lifetime per MCP session, and a compact `get_gtts`. Until answered, plan place-only.

## What "simple, integrated, fast" means here

- **Simple:** one connector per broker, about 6 skills, one state folder, one place for each rule.
- **Integrated:** every skill reads the same normalized snapshot; brokers, GTTs, verdicts and trades are joined in code, not by the model.
- **Fast:** no proxy cold start, no 70K payloads in context, no 300 KB of prose at session start. Target: daily check under 60 s and under 30K tokens after login.
