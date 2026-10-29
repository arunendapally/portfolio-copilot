---
name: risk
description: Risk and allocation review. Use for "risk check", "weekly risk update", "monthly rebalance", "allocation check", "review my MFs", "fund review", "rate sensitivity", "quarterly review", or "basket for [amount]".
---

# Risk

1. Run the check skill's connect and pull steps if today's data is not live.
2. Call `check`. From its text, present: cash vs buffer (say where the buffer is held), concentration alerts with their base (% of book, % of direct equity, % of fund book), allocation drift vs targets.
3. Call `rate_map`. Before an RBI policy meeting, call out the most exposed names.
4. Funds ("review my MFs"): for each active fund held, apply the fund screen in this order and say which step it fails: (a) is there a structural reason an index fund cannot do this job; (b) total expense ratio vs the index alternative; (c) overlap with other holdings. Past returns are never a reason to hold. Cite a dated source for every fee and figure (fetch it; prefer static pages such as Advisorkhoj over JS-rendered ones).
5. Rebalancing: close drift with new money first, not sales. Name the buckets that are under target. To turn an amount into orders, call `draft_basket` (amount + destinations the investor names or the saved `deployment_plan.destinations`). Show its text; the investor enters the basket in Kite web and presses Execute.
6. No deployment suggestion while `check` reports cash below buffer (unless the profile says the buffer is in the bank).
7. Buffer and cover: call `protection_check`. It measures the emergency fund against 6 to 12 months of expenses and reports term cover, health cover and SIPs from the investor's saved inputs. Missing inputs are asked for, then saved with `profile_update` (`protection.*`, `sips`).
8. After any new verdict, call `verdict_notes` and offer its text for the investor to paste into their notes file; the profile stays the source.
9. `log_append` the findings.

Analyze only what the investor holds or names; never suggest new securities.
