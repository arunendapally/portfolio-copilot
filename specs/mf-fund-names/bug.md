## Repro

Test: tests/mf-names.test.js "Largest positions shows a Kite mutual fund by its name, not its ISIN" and "the position symbol stays the ISIN, so profile mappings and day-to-day diffs keep working"
Steps: `refresh` from a Kite book whose `get_mf_holdings` row has fund "Kotak Emerging Equity Fund" and tradingsymbol INF174K01LS2, large enough to be in the top 10; read the "Largest positions" table
Report: issue #30 (live `check my portfolio` run, 6 Nov 2026)

## Expected and actual

Expected: the table row reads "Kotak Emerging Equity Fund", and the position still carries the ISIN as its symbol
Actual: the row reads "INF174K01LS2"; the consolidated position has no name at all

## Root cause

core/lib/brokers/normalize.js:51 keys a Kite fund by its ISIN (`tradingsymbol`) and keeps the fund name only in `name`. core/lib/snapshot.js:76 groups positions by symbol and drops `name`, assuming the symbol is readable; core/tools.js:183 prints `p.symbol`.
Trap: a display table that prints an identifier field because it assumed the identifier is human readable [unconfirmed: not added to standards/traps.md, the repo has none]

## Fix

core/lib/snapshot.js:76-77, 83: keep the fund name on the position (only for `mf` rows whose name differs from the symbol, and only add the field when set). core/tools.js:183: print `p.name || p.symbol`. The symbol is unchanged on purpose, because profile `symbol_buckets`, `rate_map`, the change diff and audit all key on it. CHANGELOG entry under Unreleased; regenerated lite edition and bundles; no version bump (the bug lane refuses package.json). Left alone: the "Changes since" table, which still prints symbols, so a fund change can show the ISIN there.

## Test results

Repro: tests/mf-names.test.js, both tests red on the base (8c82aab), green on this commit
Suite: 117 passed, 0 failed, 0 skipped (baseline 117, run by `sdlc gate`)
Gate: green, PR size 58 of 200 code lines (sdlc gate mf-fund-names)
Removed, skipped or quarantined: none

## Pre-review

<!-- Written by the pre-reviewer agent. -->

## Not verified

A live Kite MF read: only the fixture row ran, so a real `get_mf_holdings` payload with a missing or differently named `fund` field is not covered.
The "Changes since" table and the audit output still show the ISIN for funds.
