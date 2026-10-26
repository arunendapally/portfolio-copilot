---
name: get-started
description: Onboard an investor, or import an existing investor's notes. Use for "get started", "set up my portfolio", "I'm new to this", "update my profile", "import my notes", or right after installing the plugin.
---

# Get started

Plain language; explain each term (GTT, XIRR, SIP) once in a short parenthesis.

1. Disclaimer first, and wait for an acknowledgement: "I provide analysis, not investment advice. I'm not SEBI-registered, I never suggest what to buy, and no order runs unless you approve the exact draft by clicking Yes in an inline question that lists every order."
2. Ask which folder to keep their portfolio files in. Pass it as `folder` on the first portfolio-core call; it is remembered.
3. Ask in one friendly message: goal and years to it; a 20% fall in a month: sell, hold or buy more (conservative / balanced / aggressive); monthly investment and idle lump sum; brokers (Zerodha and Kotak Neo connect live; IBKR via its connector; any other broker by CSV import); where the emergency cash buffer is kept (broker or bank).
4. Save with `profile_update`, one path at a time: `investor.*`, `brokers.kotak.enabled` and `brokers.kotak.ucc`, `cash.buffer_location`, `allocation.targets` if they have them, `deployment_plan` if they have a staged plan. For the plan, save `corpus_source` (the name of the holding that is the war chest, e.g. "ARBITRAGE") rather than a fixed `corpus_inr`, so the corpus is read live, and set `stages[i].done_at` for stages already deployed. Confirm each in a short summary.
5. Verdicts: as the investor states a stance on a holding, save `verdicts.<SYMBOL>` = `{stance, reason, exit_level?}`. Stances: hold, add, hold_no_add, reduce, exit, or trade (a short-term position with its own stop and target).
6. Existing notes ("import my notes"): read their files, extract rules only (thresholds, GTT policy, buffer location, allocation targets, staged plan, verdicts with reasons). Show each proposed item and save it only after the investor confirms it. Never import snapshot numbers (quantities, prices, P&L, dated totals) as rules.
7. Write the first `log_append` with `start_here`: goal, current state in one line, next actions, decisions owed.
8. Run the check skill for the first snapshot. Explain it in 3-4 sentences and the one most important next action.
9. Offer a routine: "check" each morning, "risk" on Fridays, "gtt" after any buy or sale. A scheduled weekday check works, but Indian brokers expire logins daily, so an unattended run gives macro plus the last snapshot.
