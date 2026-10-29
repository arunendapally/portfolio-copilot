---
name: gtt
description: GTT (standing order) audit and fixes under the investor's GTT policy. Use for "audit GTTs", "check my GTTs", "GTT review", "are my positions protected", "fix my stop-losses", after a corporate action, or when a check shows GTT gaps.
---

# GTT

## Policy (defaults; the profile's `gtt_policy` overrides)
Stops protect against a broken thesis, not a market-wide fall.
1. Index and commodity ETFs: target only, no stop.
2. Hold/add stocks: crash-floor stop about 25% below price, never closer than 20%.
3. EXIT/REDUCE verdicts: a single exit at the written level, no stop.
4. No verdict means hold.
5. Every audit includes the crash test (-10%, -20%). A hold/add name that fires at -20% is not widened automatically: analyze it first (step 4).
   - Strong company, fall driven by macro or the market (oil, war, rates, a broad selloff): widen to the crash floor.
   - Company weakening (results, asset quality, margins, governance): keep the stop and let it exit.
   - A `trade` verdict keeps its own stop and target; the crash-floor rule does not apply to it.
6. GTT quantity equals held quantity.
7. A hold name whose stop is tighter than the minimum but carries `verdicts.<SYMBOL>.stop_review` with `decision: "keep"` is shown as "kept by decision" until its `review_by` date; the audit, crash test and plan leave that stop alone. After `review_by` it is flagged again.
This policy lives in the portfolio engine; do not restate or improvise thresholds.

## Steps
1. If today's Kite data is not live, read it with the Kite MCP and run `pc broker_status` and `pc refresh` first (see the check skill). Otherwise findings are unverified and say so.
2. Optional: search held symbols for upcoming bonus/split/demerger; pass them as `corporate_actions`.
3. Call `gtt_audit`. Show its text.
4. If the investor wants fixes: for every hold name with a `stop_too_tight` finding, run the analyze skill first and classify it (policy 5). Then call `draft_gtt_plan` with `symbols` set to only the names to widen, plus any quantity or ETF/exit fixes. Show the full plan text. New GTTs are placed before old ones are deleted.
5. Approval (full edition): ask with `AskUserQuestion`, exactly as the plan text says. Use header = the code. The question names the code and lists every row (action, symbol, qty, trigger/target, reason). Give two options in this order: "No, don't place", then "Yes, place <code>". Never pre-fill answers; only the investor's click counts, and a plain "yes" typed in chat approves nothing.
6. After the hook confirms the approval: make the Kite MCP calls listed in the plan, one per row, with exactly those arguments (`place_gtt_order` rows first, `delete_gtt_order` only after every place succeeded). The order gate allows each row once. If a delete fails in the MCP, delete only those ids in Kite web (Orders > GTT, the investor's logged-in tab), ticking exactly the planned ids and checking that "Delete N selected" equals the planned count. Never log in for them.
7. Verify: read GTTs again, run `pc refresh` and `pc gtt_audit`: one GTT per holding at the held quantity. Lite edition, or no approval: the investor enters the plan in Kite web, then verify the same way.
8. `log_append` what changed.

Broker order tools are called only for rows of an approved draft; the order gate blocks everything else, and a row that was already used.
