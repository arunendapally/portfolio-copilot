# Review: missing-profile-defaults

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
| F1 | minor | core/tools.js:481 | 2 | draft_orders never reads the profile (core/tools.js:434-445) but is not in PROFILE_TOOLS, so with no profile.json an IBKR or cancel-order draft opens with "GTT, allocation and sector findings below may be wrong", which is false for it and may make the investor distrust a correct order draft. The list is opt-out, so every future tool is warned by default. Add draft_orders to the exempt set (or make the set name the tools that do not compute from the profile). | open | pre-review |
| F2 | minor | tests/missing-profile.test.js:22 | 9 | No call without args.folder. The wrapper resolves the path again via profiles.load(undefined), which goes through resolveFolder (core/lib/state.js:58: PORTFOLIO_COPILOT_HOME, then remembered last_folder, then cwd). Reading the code it matches the handler, but the remembered-folder path is the one a real chat uses after the first call and no test pins it. Add one tool call with no folder after a call that remembered the folder. | open | lens:tests |
| F3 | minor | tests/missing-profile.test.js:26 | 15 | The warning test only checks the warning and the flag. It never checks that the tool's own output still follows, or that draft_gtt_plan and draft_basket actually drafted (r.ok). An error result also gets the warning, so a tool that broke without a profile would still pass. Assert r.ok and that the text after the warning is the tool's output. | open | lens:tests |
| F4 | nit | core/lib/brokers/normalize.js:167 | 2 | Sibling question: kotakHoldings has an isin column but does not apply the INF rule; it relies on the broker's type and subtype columns. Probably fine since Kotak reports ETF type itself, but say so in bug.md or apply the same rule. | open | pre-review |
| F5 | nit | core/tools.js:489 | 2 | Question for the human, not a defect: draft_gtt_plan, draft_basket and draft_orders still create a draft with no profile and only warn. With no verdicts every name is default hold, so a GTT plan drafted on defaults is the exact harm in #28. Decide whether drafting should refuse without a profile. bug.md records warn-not-refuse as a deliberate choice. | open | pre-review |
