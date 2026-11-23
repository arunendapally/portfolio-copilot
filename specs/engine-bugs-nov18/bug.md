<!-- Bug lane. Owner: builder agent; the pre-reviewer agent writes Pre-review. Gate: a CODEOWNER engineer, asked with "sdlc ask <feature>"; under autonomy it passes on its checks.
     One file from start to merge, and the PR body. Build passes on checks: the repro red before the fix,
     the gate green after, under the line limit (tasks.md Budget), and no change to dependency manifests,
     migrations, .github, infra or terraform (those make it a feature). Write Repro and Expected and actual
     before any fix.
     A required section with only a comment in it is empty, and the gate refuses it. Keep every "## " heading
     exactly as written; never start a line with "# " or "## " inside a section.
     Every line states a fact with its source: a test, a command run on this commit, a file:line or a link;
     end one you did not check with [unconfirmed]. -->

## Repro

Test: tests/engine-bugs-nov18.test.js (6 tests, grouped by bug)
Bug 1 steps: Kite enabled, nothing captured yet, run broker_status with tools mcp__kite__session, portfolio, gtt, market, orders (test "broker_status with the grouped Kite tools ...")
Bug 2 steps: ingest broker ibkr with the rows under positions; with rows under any other key; with cash given as an object (tests "ingest takes IBKR rows under positions ...", "ingest refuses rows under a key ...", "ingest refuses IBKR cash ...")
Bug 3 steps: export a snapshot with Kite, Kotak Neo and IBKR rows; export a Kite holding read from portfolio holdings full (tests "export writes broker, type, kind and bucket ...", "export prevClose for a Kite stock ...")
Report: C:\Arun-Personal\Investment\feedback.md entries "2026-11-18 (evening)" and "2026-11-19 (morning)" (no GitHub issue was filed)

## Expected and actual

Expected: broker_status returns the Kite session check (mcp__kite__session {"mode":"status"}) as the next call; ingest takes positions and refuses an unknown key or unreadable cash; export rows read broker "Kite", type "Equity", kind "Stock", bucket "India equity", asof "2026-11-19 14:36 IST" as in the dashboard's positions-2026-11-19c.json, and Kite prevClose equals Kite close_price
Actual: broker_status says kite "not connected, the Kite MCP is not in this chat"; ingest with positions says "Ingested 0 ibkr holdings" and cash is saved as null; export writes broker "kite", type "equity", kind "stock", bucket "india_equity", asof an ISO timestamp, and prevClose is the previous snapshot's ltp (tests/engine-bugs-nov18.test.js, 6 of 6 red on 93d3c3f)

## Root cause

Bug 1: core/tools.js:55 brokerStatus replaces any tools the caller passes with the tool names found in captures, assuming the capture hook has already seen a read. Before the first read, or in a chat where the hook does not run, that list is empty, so connect gets ["none"] and reports Kite as not in the chat although its grouped tools are there. The tool map (core/lib/brokers/toolmap.js) already maps the grouped tools, and doctor and capture handle them (scripted session on 2bd000b: capture records portfolio, gtt and session; doctor shows gen 2, can read, can write).
Bug 2: core/tools.js:124 reads rows only from args.holdings and defaults to [], so rows under positions (the IBKR read is get_account_positions) or any other key ingest as 0 rows without an error; core/tools.js:135 saves norm.num(args.cash), which turns an unreadable cash value into null without saying so.
Bug 3: core/lib/export.js:28 writes the engine's internal codes (broker id, type, bucket id, lowercase kind) and an ISO asof, assuming the dashboard reads them; the dashboard's positions file uses display labels. core/lib/export.js:31 takes prevClose from the previous snapshot's ltp (an intraday price, possibly days old) because core/lib/brokers/normalize.js:26 kiteHoldings drops Kite's close_price; core/lib/marks.js:39 already reads h.prev_close and never gets it.
Trap: a fallback that turns a missing input into an empty or null value (args.holdings || [], num(cash)) hides a caller mistake as a valid zero [unconfirmed: not checked against standards/traps.md]

## Fix

Bug 1: core/tools.js:56 brokerStatus adds the caller's tools to the captured tool names, and keeps from_captures only when none were passed (so a missing read is still reported); the tool description names the new tools argument. Toolmap, doctor and capture are unchanged: they already map the grouped tools.
Bug 2: core/tools.js:127 takes rows from holdings or positions (bare array, or an object wrapping them; normalize.js:21 items() now also unwraps positions) and refuses any other shape, naming the keys it got; core/tools.js:142 refuses cash that is given but is not a number; core/tools.js:152 says when no cash was given. Holdings with no cash still ingest, as before.
Bug 3: core/lib/export.js:15 maps broker, type, kind and bucket to the dashboard labels (unknown codes fall back to sentence case) and writes asof with istStamp; key stays the engine id (kite:SYMBOL), as the dashboard file has it. normalize.js:36 kiteHoldings keeps close_price as prev_close (0, which Kite sends when it has no close, becomes null), and export.js:37 prefers it over the previous snapshot's ltp. marks.js:39 now gets prev_close too (it already read it).
Left alone: the dashboard's hand-written kind detail ("Fund (Gold)", "ETF (USD)") and the liquid-fund "Cash" bucket, which the engine has no data for; the session-start hook text; the .plugin bundles (built at release). editions/lite regenerated with node scripts/build.js.

## Test results

Repro: tests/engine-bugs-nov18.test.js 6 of 6 red on the base (93d3c3f, node --test), 7 of 7 green on this commit (the 7th is the pre-review close_price guard, red without it)
Suite: 281 passed, 0 failed, 0 skipped (npm test; baseline 274 on 2bd000b plus the 7 new)
Changed existing test: tests/export.test.js cash broker expectation "kite" to "Kite", the intended schema change
Gate: sdlc gate could not run, because .ai-sdlc/config.json has no gateCommand and only a person may set it (sdlc gate engine-bugs-nov18 output); npm test was run by hand instead
Removed, skipped or quarantined: none

## Pre-review

Risk: medium, because it changes code (core/tools.js, core/lib/export.js, core/lib/brokers/normalize.js) and touches no high-risk path
Open findings: 0
Look here first: core/lib/export.js:15 (is changing the export to display labels right for every reader, or does anything else read the old codes? Only the dashboard was found); core/tools.js:142 (an IBKR ingest with cash in a non-numeric form is now refused outright: acceptable, or should it save holdings and warn?); core/tools.js:58 (broker_status with tools runs the tool-based read check, so a chat missing a Kite read now shows tools_changed instead of a capture-based status)
Lenses run: tech-lead self-review (correctness, tests) against the code review checklist. The pre-reviewer agent was started but ended without recording any finding or report, so its lenses did not run
Revert: git revert of the merge commit; no data to back out (export files are rewritten on the next export)
Checked mechanically: checklist 1, 5, 9, 13, 14 (close_price guard mutation-tested: red without it), 21, 22, 24; the 6 repro tests fail on the base; no secrets in the diff
Could not check: a live Kite, IBKR or dashboard round trip (no live broker reads from Claude Code); sdlc gate (no gateCommand configured)

## Not verified

No live broker read: the IBKR positions and balances payloads and Kite close_price were checked against the test fixtures and the 6 Nov snapshot, not a fresh pull (Claude Code makes no live broker reads).
The dashboard reading the new export file end to end: the labels were compared with the dashboard's positions file of 19 Nov (dataset "positions"), not loaded into it.
broker_status in a chat where the capture hook does not run (the cloud session of 18 Nov): it now names the session check, but the reads stay uncaptured there, so refresh still has no Kite data.
