# Review: ibkr-etf-bucket

<!-- Stage 5 Verify. Owner: pre-reviewer agent. Gate: with pr.md; the gate reads every row and refuses an open blocker, major or minor.
     The findings ledger: one table row per finding, from the pre-reviewer, every lens and every human.
     Replace <feature> above. No findings is a valid ledger; the PR's "Lenses run:" line says what was looked at.

     Example:
| F1 | major | src/lists/save.ts:58 | 6 | Saving twice adds two rows: no unique key on (shopper, item). A replayed POST shows it. | fixed: 5d6e7f8 | pre-review |
| F2 | minor | src/stock/events.ts:12 | 25 | Hand-rolled retry loop where src/lib/retry.ts exists. | wontfix: src/lib/retry.ts retries 5xx only and this call must retry 409 | pre-review |
| F3 | nit | src/lists/save.ts:20 | 22 | Unrelated reformat of the import block. | open | lens:tests |
| H1 | major | src/web/SavedList.tsx:44 | 11 | Sold out is checked in the UI only; the API still saves a sold-out item. Confirmed by Ana. | fixed: 9c8d7e6 | human |

     Each cell, and what the gate refuses:
     ID        F1, F2 ... for agents; H1, H2 ... for humans. Take the next number. Never reuse, renumber or delete a row.
     Severity  blocker: wrong or unsafe, cannot ship. major: a real defect or a missing test. minor: fix before merge. nit: taste, may stay open.
     Location  file:line from the repo root, no spaces, where the code is now. When the code moves, move the line.
     Checklist the item number only from standards/code-review-checklist.md: 6, not "B6" or "idempotent". The gate finds repeats by it.
     Finding   what is wrong, why it matters, how to see it. Never type a pipe character: it splits the row and the gate refuses it.
     Status    open | fixed: <sha of the commit that fixed it> | wontfix: <reason>. On a high-risk change the commit must change
               the Location file. A blocker is never wontfix.
     Source    pre-review | human | lens:<name>, no space after the colon: lens:security, lens:tests, lens:data, lens:performance.

     A finding seen before: set its old row back to open; a new row on the same file and checklist item as a closed one is refused.
     A bug with siblings: one row that names the class and lists every place.
     Humans: agree with an agent row by adding "Confirmed by <name>." to its Finding. Add your own as an H row with source
     human; sdlc retro reads H rows to learn what the pre-review misses. -->

| ID | Severity | Location | Checklist | Finding | Status | Source |
|---|---|---|---|---|---|---|
| F1 | minor | core/lib/rates.js:21 | 23 | Sibling of the same root cause (type decides, currency ignored). classify treats only type foreign as foreign equity, so VOO and QQQM ingested from IBKR with type etf fall through to unknown and rate_map (core/tools.js:356) lists them under Unclassified with the advice to add a sector, instead of least exposed as foreign equity. Fix the class: pass the holding currency into classify, or decide it once in one helper both callers use. | fixed: ba0ad10 | pre-review |
| F2 | minor | tests/ibkr-bucket.test.js:39 | 14 | The NIFTYBEES INR row proves nothing about name bucketing: it matches no name rule and lands in india_equity through the final default, so deleting the name rules or putting the currency rule after them still passes. Use an INR row a name rule catches (GOLDBEES expecting gold) so the guard fails if the new rule swallows INR rows. Split precedence and INR checks so a failure is attributable. | fixed: ba0ad10 | lens:tests |
| F3 | nit | core/lib/snapshot.js:34 | 21 | The currency rule runs before the GOLD, SILVER and debt name rules, so a USD row whose symbol matches them now reads global_equity. Recorded in bug.md Fix as accepted, but the CHANGELOG entry does not tell users to map USD gold or debt ETFs in allocation.symbol_buckets. Low impact: ingest drops the name field, so only the symbol is matched. | fixed: ba0ad10 | pre-review |
| F4 | nit | tests/ibkr-bucket.test.js:29 | 16 | assert.ok(!alloc.india_equity) passes for absent, 0 or undefined alike; strictEqual against the expected absence is tighter. | fixed: ba0ad10 | lens:tests |
