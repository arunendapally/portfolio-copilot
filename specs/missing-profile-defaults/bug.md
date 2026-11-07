## Repro

Test: tests/missing-profile.test.js "without profile.json every policy tool says it is using defaults, and names what that skips" and "an INF-prefixed ISIN is an ETF even when the symbol and the profile do not say so"
Steps: point `gtt_audit` (or `refresh`, `check`, `draft_gtt_plan`) at an investor folder with no `profile.json`; the Kite book holds HDFCSML250, MIDCAP, TOP100CASE, ICICIB22 (ETFs without a BEES/ETF name) and IGL, JIOFIN (EXIT verdicts in the real profile)
Report: issues #28 and #32 (live run on a stale uploaded folder copy, 6 Nov 2026)

## Expected and actual

Expected: a run with no `profile.json` opens with a warning naming the defaults it fell back to (no verdicts, no sector map), and an `INF` ISIN holding is typed `etf`
Actual: no warning from any tool except `profile_get`; `kiteHoldings` typed HDFCSML250 (ISIN INF179KC1981) as `equity`; the audit and GTT plan gave hold/crash-floor findings for ETFs and dropped the EXIT verdicts

## Root cause

core/lib/profile.js:120 returns `exists`, but only `profileGet` (core/tools.js:371) reads it; every other tool takes `{ profile }` and carries on, assuming the profile file is always there. core/lib/brokers/normalize.js:12 types an ETF only from `gtt_policy.etf_symbols` or a name ending BEES/ETF, assuming the profile lists every ETF.
Trap: a default that stands in for missing investor data is applied silently [unconfirmed: not added to standards/traps.md, the repo has none]

## Fix

core/tools.js `callTool`: when the profile file is missing, prepend one warning to the text of every tool except profile_get, profile_update, report_gap and log_append, and set `profile_missing: true` (7 lines, one place instead of eleven handlers). core/lib/brokers/normalize.js:34: also type `etf` when the ISIN starts INF (1 line). CHANGELOG entry under Unreleased, and the regenerated lite edition and bundles. No version bump: the bug lane refuses package.json, so a release change bumps it later. Left alone: kotakHoldings (its ISIN column is not used; Kotak types come from its own columns); the tools still run on defaults, they do not refuse; drafting a GTT plan without a profile is still allowed, with the warning.

## Test results

Repro: tests/missing-profile.test.js, 2 of 4 tests red on the base (38718ab: the warning test and the INF ISIN test), green on this commit; the other 2 are guards that passed before and after
Suite: 111 passed, 0 failed, 0 skipped (baseline 111, run by `sdlc gate`)
Gate: green, PR size 24 of 200 code lines (sdlc gate missing-profile-defaults)
Removed, skipped or quarantined: none

## Pre-review

Risk: medium, because it is a code change with repro tests that fail on the base (38718ab), no high-risk path, no data or contract change; the new text prefix and profile_missing field are additive.
Open findings: 1 (F5, nit: a question for the human on warn vs refuse; no blocker, major or minor open)
Look here first: core/tools.js:489 (F5: draft_gtt_plan and draft_basket still draft on defaults with only a warning; with no verdicts every name is default hold, the exact harm in #28; decide whether drafting should refuse without a profile), core/lib/brokers/normalize.js:35 (the INF rule: INF ISINs are fund units, so a demat unit of a non-ETF fund is now typed etf; judge whether etf typing and its GTT treatment is right for such units)
Lenses run: correctness, simplicity, tests
Revert: git revert of the merge commit, then rebuild editions/lite and the two .plugin bundles (node scripts/build.js) if the revert does not carry them; no data to back out (no profile, snapshot or state format change)
Checked mechanically: checklist items 1, 2, 9, 13, 15, 16, 21, 22, 24 to 26; 2 of the original 4 repro tests fail on the base and the rest are named guards; full suite 111 of 111 pass; F1 to F3 re-checked in 38e8908; editions/lite core/tools.js and normalize.js identical to core; warning cannot break in-repo callers (core/bin/pc.js only prints text, nothing parses it); remembered-folder calls resolve the same profile path as the handler (both go through resolveFolder) and are now tested; no new dependency; no secrets; packet signals cleared (the .plugin bundles are build output)
Could not check: a live run against the real investor folder in a cloud chat; the contents of the two .plugin bundles (not unpacked); that draft_gtt_plan and draft_basket return ok without a profile (the loop test asserts the warning only, ok is asserted for gtt_audit and check)

## Not verified

A live run against the real investor folder on a cloud chat: only the test fixtures ran.
Whether sector findings elsewhere still use an empty sector map after the warning: the warning says so, the behaviour is unchanged.
