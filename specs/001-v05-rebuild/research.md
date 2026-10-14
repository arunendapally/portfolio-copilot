# Research: v0.5 rebuild

All findings dated 2026-10-14 unless noted.

## R1. Can a local process talk to the hosted broker MCPs directly?

**Decision**: Yes. `portfolio-core` is an MCP *client* to both hosted broker servers over plain
HTTP JSON-RPC, and an MCP *server* (stdio) to Claude.

**Evidence** (live probes):
- `POST https://mcp.kite.trade/mcp` `initialize` returns 200 JSON with an `mcp-session-id`
  header (`kitemcp-<uuid>`), protocol `2025-03-26`, server "Kite MCP Server v0.3.2". No OAuth.
  22 tools, including `place_gtt_order`, `modify_gtt_order`, `delete_gtt_order`, `get_gtts`
  (`from`/`limit` paging), `login`.
- `POST https://neo.kotaksecurities.com/mcp-server/mcp` returns 200 JSON, protocol
  `2025-06-18`, stateless: every tool takes `sessionid` as an argument. 13 tools, read-only plus
  login. No order tools exposed.

**Alternatives rejected**: `npx mcp-remote` proxy (cold-start timeouts, reconnects lose the
session, two copies when the user also has a connector); requiring Kite Connect developer keys
(setup burden; spec assumption says no).

## R2. What does Kite's "Failed to execute" mean?

**Decision**: on Kite, any tool error on a data call means "not authenticated on this MCP
session" unless the HTTP layer itself failed. Outage = network error, timeout, or HTTP 5xx only.

**Evidence**: on a fresh session, `get_holdings` returned "Please log in first" on the first call
and "Failed to execute get_holdings" on every later call, before and after `login` was called
without authorising. The field log's "Failed to execute after login" (24-Jul, 29-Jul, 14-Oct)
matches a session that was not the one the user authorised.

**Consequence**: FR-004 is implemented as: tool-level error => needs login (re-issue the link
from *this* session); transport-level error => outage. The session id is persisted so the
authorised session is reused across Claude restarts the same day.

## R3. `delete_gtt_order` "trigger_id is required"

**Finding**: schema declares `trigger_id: number`. Unauthenticated probes: `1` => "Please log in
first"; `"1"` and `1.0` => "Failed to delete GTT order". Not conclusive without a login.

**Decision**: core sends an integer. If the server still rejects it, the plan step is reported
as "delete manually in Kite web: <ids>" and verified on the next `get_gtts`. Place-then-delete
ordering makes either outcome safe.

## R4. Approval mechanism for orders

**Decision**: drafts get a short code (`D` + 4 chars). A `UserPromptSubmit` command hook records
an approval when the *user's own prompt* contains `approve <code>`; it stores a hash of the
draft's rows at that moment. `execute_draft` refuses unless the approval exists and the hash
still matches. A `PreToolUse` command hook blocks every other order-capable tool
(`mcp__*__(place|modify|delete|cancel)_(gtt_)?order`) unless its arguments match a row of an
approved draft.

**Why**: deterministic, no model call, works for any connector. Threat model is model error and
drift, not a hostile model with shell access (documented). If hooks do not load, no approval can
be recorded, so execution fails closed.

**Rejected**: prompt hook (probabilistic, 30 s per order); transcript parsing (format not
documented as stable).

## R5. Runtime and dependencies

**Decision**: Node >= 18 (built-in `fetch`, `node:test`), zero npm dependencies. The MCP stdio
server is ~150 lines of newline-delimited JSON-RPC. No install step, fast start.

## R6. State location

**Decision**: per-user portfolio state in `<working folder>/portfolio-copilot/` (`profile.json`,
`snapshots/`, `drafts/`, `log.md`, `log/`). Broker session ids in `~/.portfolio-copilot/`
(file mode 0600), never in the working folder. Working folder = tool argument `folder`, else
`PORTFOLIO_COPILOT_HOME`, else last used, else process cwd.

## R7. IBKR and other brokers

**Decision**: IBKR is a claude.ai connector with OAuth, so core cannot call it. The model calls
`get_account_summary` (primary) and `get_account_positions`, then passes the small result to
core `ingest`. Same `ingest` path serves statement imports (CSV path).

## R8. Kotak payload format

**Finding**: holdings come back as delimited text (CSV) with header names that are not
documented. **Decision**: tolerant CSV parser with header aliases; on unknown headers, return a
clear error listing the headers and save the raw text to `~/.portfolio-copilot/raw/` for a fix.

## R9. Evals

**Decision**: deterministic logic gets `node:test` unit tests on scrubbed fixtures (fast, in CI).
Model behaviour gets `evals/run-evals.py` (moved from the personal folder, paths parametrised)
with T0 load, T1 house rules, T2 order gate, T3 analysis, T9 policy lint. CI runs unit tests,
validate and T9 on every PR; T0-T3 run before release.
