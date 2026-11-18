---
name: get-started
description: Onboard an investor, or import an existing investor's notes. Use for "get started", "set up my portfolio", "I'm new to this", "update my profile", "import my notes", or right after installing the plugin.
---

# Get started

Plain language; explain each term (GTT, XIRR, SIP) once in a short parenthesis.

1. Disclaimer first, and wait for an acknowledgement: "I provide analysis, not investment advice. I'm not SEBI-registered, I never suggest what to buy, and no order runs unless you approve the exact draft by clicking Yes in an inline question that lists every order."
2. Ask which folder to keep their portfolio files in. Pass it as `--folder` on the first `pc` command; it is remembered.
3. Ask in one friendly message: goal and years to it; a 20% fall in a month: sell, hold or buy more (conservative / balanced / aggressive); monthly investment and idle lump sum; brokers (Zerodha and Kotak Neo connect live; IBKR via its connector; any other broker by CSV import); where the emergency cash buffer is kept (broker or bank).
4. Save with `profile_update`, one path at a time: `investor.*`, `brokers.kotak.enabled` and `brokers.kotak.ucc`, `cash.buffer_location`, `allocation.targets` if they have them, `deployment_plan` if they have a staged plan. For the plan, save `corpus_source` (the name of the holding that is the war chest, e.g. "ARBITRAGE") rather than a fixed `corpus_inr`, so the corpus is read live, and set `stages[i].done_at` for stages already deployed. Confirm each in a short summary.
5. Verdicts: as the investor states a stance on a holding, save `verdicts.<SYMBOL>` = `{stance, reason, exit_level?}`. Stances: hold, add, hold_no_add, reduce, exit, or trade (a short-term position with its own stop and target).
6. Your own rules, for the daily review. Ask; save only what they give; leave the rest empty (the review lists it as "not set", never a default):
   - drift bands per bucket in percentage points (`allocation.bands_pp.<bucket>`);
   - the sector map (`sectors.<SYMBOL>`), including sector funds that should count toward a sector, and the base for the sector limit (`limits.sector_base`: stocks only, stocks and funds at Kite, or the whole book);
   - core or play per holding where the default (funds core, stocks play) is wrong (`classes.<SYMBOL>`);
   - tripwires per stock, inside its verdict: `tripwires` (metric, below or above, for how many quarters) and `on_tripwire` (exit, reduce or review), and `next_results` (date);
   - the plan path (`plan`: start date and book value, monthly amounts, yearly step-up, expected return, how far behind is too far) and the loss tolerance on play trades (`loss_tolerance`: amount, from date, measured on realised plus open losses);
   - your own log file, if you keep one (`log.path`: a file name in this folder).
7. Existing notes ("import my notes"): read their files, extract rules only (thresholds, GTT policy, buffer location, allocation targets and bands, sector map, tripwires, staged plan, plan path, verdicts with reasons). Run `profile_get`, then show a diff: each rule that is new or differs from the profile, with the old and new value. Save each item only after the investor confirms it. Never import snapshot numbers (quantities, prices, P&L, dated totals) as rules.
8. Write the first `log_append` with `start_here`: goal, current state in one line, next actions, decisions owed.
9. Run the check skill for the first snapshot. Explain it in 3-4 sentences and the one most important next action.
10. Offer a routine: "review" each morning, "Friday review" on Fridays, "gtt" after any buy or sale. A scheduled weekday review works: it never asks for logins, evaluates what it can, and waits for you before proposing anything.
