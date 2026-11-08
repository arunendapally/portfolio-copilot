## Repro

Test: tests/paged-reads.test.js "a read made with limit or from is partial: it is reported by name, not taken as the full list", "a later page (from above 0) is partial too" and "the stale message names only the reads that are old"
Steps: capture get_holdings and get_margins, then get_gtts with `limit: 1` (one row); call `inputs.pull('kite')`. Separately: capture all three, refresh holdings and margins 40 minutes later, pull at 45 minutes
Report: issue #31 (live `check my portfolio` run, 6 Nov 2026)

## Expected and actual

Expected: the one-row get_gtts is reported as partial by name ("get_gtts was read with limit=1 ... call it again without limit or from"), and the stale message names only get_gtts
Actual: the paged read is accepted and Kite reads `live` with a one-GTT list; the stale message says "call the Kite MCP get_holdings, get_gtts and get_margins" although only get_gtts is old. The reported symptom (status stuck stale until an unpaged read) did not reproduce [unconfirmed: the live run may have lost the paged capture in the cloud chat]

## Root cause

core/lib/session.js:41-48 saves any broker read as a complete one: `record` never sees the tool arguments (hooks/capture.js passed only the response), assuming every get_ call returns the whole list. core/lib/inputs.js:60-61 takes the oldest capture across all reads and prints the one hint that lists all three.
Trap: a cache keyed by tool name that ignores the arguments which change what the answer covers [unconfirmed: not added to standards/traps.md, the repo has none]

## Fix

hooks/capture.js: pass `tool_input` to `record`. core/lib/session.js: `pagedBy` marks a read made with `limit` above 0 or `from` above 0 as `paged` (record field only). core/lib/inputs.js: `pull` returns `stale` for a paged read, including the optional get_mf_holdings and get_orders, and names it with the call to repeat; the stale message now lists only the reads that are older than 30 minutes. About 20 source lines. CHANGELOG entry under Unreleased; regenerated lite edition and bundles; no version bump (the bug lane refuses package.json). Left alone: the skill text, which already says to read with no limits or paging; pagination metadata inside responses is not parsed.

## Test results

Repro: tests/paged-reads.test.js, 4 of 6 tests red on the base (a58a46e: 'live' for a paged read, all three reads named in the stale message), green on this commit; the other 2 are guards (unpaged reads stay live, a failed paged read is an outage) that passed before and after
Suite: 123 passed, 0 failed, 0 skipped (baseline 123, run by `sdlc gate`)
Gate: green, PR size 110 of 200 code lines, about two thirds of them the new test file (sdlc gate paged-reads-stale-msg)
Removed, skipped or quarantined: none

## Pre-review

Risk: medium, because it changes when broker_status reports Kite or Kotak as live: a wrong paged rule would make every normal read stale or let a partial list through. No auth, money movement, data migration or contract change; the capture record only gains an optional field
Open findings: 0 [nits F5: age message wording; F6: a failed optional read made with limit is reported as partial, not left out]
Look here first: core/lib/session.js:45 (whether limit and from are the only Kite MCP page arguments, and whether a limit above the list size should count as paged; only a live MCP call settles it), core/lib/inputs.js:66 (a paged get_mf_holdings or get_orders now blocks the whole Kite status; judge whether optional reads should gate it), core/lib/inputs.js:70 (new stale wording the agent and investor read; the older than 30 min text is kept for tests/check.test.js:122)
Lenses run: correctness, simplicity, tests
Revert: git revert of the merge commit; the lite edition and both .plugin bundles are committed and revert with it. No data to back out: the old code ignores the paged field on stored captures
Checked mechanically: checklist items 1, 2, 5, 9, 13, 21, 22, 24, 25, 26; 4 of the 6 tests in tests/paged-reads.test.js fail on base a58a46e and pass here (run by hand on the base source), the other 2 are guards; full suite 123 pass, 0 fail; a failed paged read is an outage; the get_ltp merge is untouched (no limit or from argument, not a needed read); Kotak sessionid reads are unaffected; captures without a paged field read as unpaged; detail callers (core/tools.js:36,74,83) only print or store it; editions/lite copies and both .plugin bundles match the sources; no new dependencies; no secrets; .ai-sdlc/config.json and audit.jsonl not committed
Could not check: a live Kite MCP paged call (its argument names, what limit 0 or an oversized limit does, and which tools take paging), so the reported stays-stale symptom is still unexplained; the review packet lists files outside this change, so it was computed against an older base and git diff a58a46e..HEAD was reviewed instead; the pre-reviewer's own write of this section was blocked by the ai-sdlc hook, so the tech lead entered it from the pre-reviewer's report at the user's request

## Not verified

A live Kite MCP paged call: the test passes the arguments the hook is documented to receive (`tool_input`), but no real paged payload ran, so the reporter's "stays stale" symptom is not explained.
A paged read whose arguments use other names for page size or offset (only `limit` and `from` are checked).
