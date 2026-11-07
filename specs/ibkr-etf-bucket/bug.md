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

core/lib/snapshot.js:33: also return `global_equity` when the holding's currency is not INR (1 line, plus a comment). core/lib/rates.js:21 and core/tools.js:356: the same currency check in `classify`, so `rate_map` lists USD ETFs as foreign equity (found in pre-review). A profile mapping still wins and INR ETFs still bucket by name; two guard tests in the same file pin both. CHANGELOG entry under Unreleased; regenerated lite edition and bundles; no version bump (the bug lane refuses package.json). Left alone: gold, silver and debt ETFs held in USD also read as global_equity now; map them in `allocation.symbol_buckets` (noted in the CHANGELOG).

## Test results

Repro: tests/ibkr-bucket.test.js, the allocation test and the rate_map test red on the base (9aab563), green on this commit; the two guard tests passed before and after
Suite: 115 passed, 0 failed, 0 skipped (baseline 115, run by `sdlc gate`)
Gate: green, PR size 44 of 200 code lines (sdlc gate ibkr-etf-bucket)
Removed, skipped or quarantined: none

## Pre-review

<!-- Written by the pre-reviewer agent. -->

Risk: medium, because this is a code change in read-time classification only (allocation bucket and rate_map group), the tests fail on the base, and there is no data, schema, contract, auth or order path.
Open findings: 0
Look here first: core/lib/snapshot.js:34 (the currency rule runs before the gold, silver and debt name rules, so a USD gold or bond ETF now reads global_equity unless mapped in allocation.symbol_buckets; judge whether the CHANGELOG note is enough), core/lib/rates.js:22 (same order in rate_map: a USD bond ETF now reads least exposed as foreign equity although duration debt is most exposed; rate_overrides is the escape hatch)
Lenses run: correctness, simplicity, tests
Revert: git revert of the merge commit; no data to back out, since buckets and rate groups are computed when read and stored snapshots are unchanged
Checked mechanically: checklist items 1, 2, 3, 13, 14, 16, 21, 22, 23, 24, 25, 26; tests 1 and 2 in tests/ibkr-bucket.test.js fail on base 9aab563 and pass here, the two guards pass on both; suite 115 of 115; editions/lite rates.js, snapshot.js and tools.js match core; the only classify caller (core/tools.js:356) passes currency; Kite and Kotak rows are always INR (normalize.js) and ingest refuses them; USD ETFs typed etf stay out of the type equity filters (direct equity, sectors, single-stock alert, audit); no new dependencies; no secrets
Could not check: a live IBKR connector payload (whether rows carry their own currency field); that the two .plugin bundles equal a fresh node scripts/build.js (not run, it writes into the repo)

## Not verified

A live ingest from the IBKR connector: only the test rows ran.
Kotak and Kite holdings: they carry currency INR, so they are unchanged; not run against real broker data.
