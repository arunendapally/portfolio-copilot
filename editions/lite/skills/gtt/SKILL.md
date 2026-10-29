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
5. Every audit includes the crash test (-10%, -20%); no hold/add name should fire at -20%.
6. GTT quantity equals held quantity.
7. A hold name whose stop is tighter than the minimum but carries `verdicts.<SYMBOL>.stop_review` with `decision: "keep"` is shown as "kept by decision" until its `review_by` date; the audit, crash test and plan leave that stop alone. After `review_by` it is flagged again.
This policy lives in portfolio-core; do not restate or improvise thresholds.

## Steps
1. If today's Kite data is not live, run `broker_status` and `refresh` first (see the check skill). Otherwise findings are unverified and say so.
2. Optional: search held symbols for upcoming bonus/split/demerger; pass them as `corporate_actions`.
3. Call `gtt_audit`. Show its text.
4. If the investor wants fixes, call `draft_gtt_plan` (optionally `symbols`). Show the full plan text. New GTTs are placed before old ones are deleted.
5. Approval: the investor must type `approve <code>` themselves. Do not ask "shall I proceed?" and treat "yes" as approval; only the code counts.
6. After approval (full edition): call `execute_draft` with the code, show the result, then `refresh` and `gtt_audit` to verify. If deletes failed, give the listed ids for deletion in Kite web (Orders > GTT).
7. Lite edition, or no approval: the investor enters the plan in Kite web; afterwards run `refresh` and `gtt_audit`.
8. `log_append` what changed.

Never call broker order tools directly; the order gate blocks anything that is not an approved draft.
