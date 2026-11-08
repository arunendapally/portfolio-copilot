# Review: paged-reads-stale-msg

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
| F1 | minor | core/lib/inputs.js:70 | 2 | The paged rule covers only the NEEDED reads. A get_mf_holdings or get_orders read with limit or from is still folded into the live block at lines 70 and 74 as the full list, so funds or orders drop out silently, while the CHANGELOG says any broker read made with limit or from is no longer treated as the full read. Either check paged on the optional reads that pull uses (get_mf_holdings, get_orders) or narrow the CHANGELOG and bug.md claim to the three needed reads. | fixed: 650fdd4 | pre-review |
| F2 | minor | tests/paged-reads.test.js:40 | 9 | The pagedBy rule is tested on one side only (limit 1, from 5). Nothing shows that from 0, limit null or an absent argument stays unpaged, so a change that marks from 0 as paged would make every normal Kite read stale and no test would fail. Add the not-paged side, and assert the from=5 detail text while there. | fixed: 650fdd4 | lens:tests |
| F3 | minor | tests/paged-reads.test.js:25 | 1 | No test of a failed paged read. A PostToolUseFailure with tool_input limit 1 records ok false plus paged; pull reports outage only because the bad check at core/lib/inputs.js:58 runs before the paged check at line 63. Nothing pins that order, so a reorder would tell the investor to repeat the read without limit during an outage. | fixed: 650fdd4 | lens:tests |
| F4 | nit | core/lib/session.js:45 | 5 | limit 0 counts as paged (limit=0), and so does a limit larger than the list. If the Kite MCP treats limit 0 as no limit (unverified), a full read shows as stale until it is repeated. The message says what to do, so it recovers; consider Number(args.limit) > 0 to match the from rule. | fixed: 650fdd4 | pre-review |
| F5 | nit | core/lib/inputs.js:70 | 17 | The new age message drops the old hint for the optional reads (get_mf_holdings, get_orders, get_trades if wanted) and joins three names as A and B and C. Since get_mf_holdings has no age check, an old fund capture can ride into a live block once the three needed reads are repeated. The check skill still lists every read up front, so this is wording. | open | pre-review |
| F6 | nit | core/lib/inputs.js:66 | 2 | A failed optional read made with limit or from (get_mf_holdings with limit 1 that errored) keeps its paged field, so pull reports it as read with limit=1, holds part of the list, where before the fix a failed optional read was simply left out. The investor is told to repeat it, which also recovers, so the message is only misleading. Filtering the optional list on r.ok would keep the old behaviour. | open | pre-review |
