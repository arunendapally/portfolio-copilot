## Repro

Test: tests/ibkr-bucket.test.js "US ETFs ingested from IBKR with type etf land in global_equity, not india_equity"
Steps: `ingest` broker ibkr, currency USD, fx_rate 85, two rows (VOO 10 at 500, QQQM 5 at 200) with `type: etf`; consolidate the snapshot and read the allocation buckets
Report: issue #29 (live `check my portfolio` run, 6 Nov 2026)

## Expected and actual

Expected: allocation shows global_equity = (10 x 500 + 5 x 200) x 85 = 510000 and no india_equity
Actual: global_equity is empty; both ETFs are counted in india_equity, so the global gap is overstated

## Root cause

core/lib/snapshot.js:33 treats only `type === 'foreign'` as global, assuming every non-INR holding carries that type. `ingest` keeps the caller's `type` (core/tools.js:113), so a USD row with `type: etf` falls through to the name rules and ends in `india_equity` (core/lib/snapshot.js:39).
Trap: bucketing decided by an instrument type that the caller can override, instead of by the currency the value is held in [unconfirmed: not added to standards/traps.md, the repo has none]

## Fix

core/lib/snapshot.js:33: also return `global_equity` when the holding's currency is not INR (1 line, plus a comment). A symbol mapped in the profile still wins, and INR ETFs still bucket by name; the second test in the same file pins both. CHANGELOG entry under Unreleased; regenerated lite edition and bundles; no version bump (the bug lane refuses package.json). Left alone: gold, silver and debt ETFs held in USD would also read as global_equity; map them in `allocation.symbol_buckets`.

## Test results

Repro: tests/ibkr-bucket.test.js, 1 of 2 tests red on the base (9aab563: the VOO and QQQM test), green on this commit; the other is a guard that passed before and after
Suite: 113 passed, 0 failed, 0 skipped (baseline 113, run by `sdlc gate`)
Gate: green, PR size 30 of 200 code lines (sdlc gate ibkr-etf-bucket)
Removed, skipped or quarantined: none

## Pre-review

<!-- Written by the pre-reviewer agent. -->

## Not verified

A live ingest from the IBKR connector: only the test rows ran.
Kotak and Kite holdings: they carry currency INR, so they are unchanged; not run against real broker data.
