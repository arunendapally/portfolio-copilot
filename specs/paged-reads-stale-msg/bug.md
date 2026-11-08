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

hooks/capture.js: pass `tool_input` to `record`. core/lib/session.js: `pagedBy` marks a read made with `limit` or with `from` above 0 as `paged` (record field only). core/lib/inputs.js: `pull` returns `stale` for a paged read and names it with the call to repeat; the stale message now lists only the reads that are older than 30 minutes. About 15 source lines. CHANGELOG entry under Unreleased; regenerated lite edition and bundles; no version bump (the bug lane refuses package.json). Left alone: the skill text, which already says to read with no limits or paging; pagination metadata inside responses is not parsed.

## Test results

Repro: tests/paged-reads.test.js, all 3 tests red on the base (a58a46e: 'live' for the paged read, all three reads named in the stale message), green on this commit
Suite: 120 passed, 0 failed, 0 skipped (baseline 120, run by `sdlc gate`)
Gate: green, PR size 102 of 200 code lines, about half of them the new test file (sdlc gate paged-reads-stale-msg)
Removed, skipped or quarantined: none

## Pre-review

<!-- Written by the pre-reviewer agent. -->

## Not verified

A live Kite MCP paged call: the test passes the arguments the hook is documented to receive (`tool_input`), but no real paged payload ran, so the reporter's "stays stale" symptom is not explained.
A paged read whose arguments use other names for page size or offset (only `limit` and `from` are checked).
