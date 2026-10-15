---
name: crash
description: Calm crash mode for sharp market falls. Use for "crash mode", "market is crashing", "Nifty is down big", or when a check shows Nifty down more than 5% intraday or 10% from its recent peak.
---

# Crash

Goal: no panic selling, no blind dip buying. Follow the investor's own written plan.

1. Make sure today's data is live (check skill steps 1-2).
2. Call `crash_check` (it reads the index level from Kite; pass `index_level` if Kite is down and you have a dated level).
3. Show its text: which stops fire at -10% and -20%, which stops would force-sell names the investor intends to keep, the stage of the saved deployment plan reached, and that stage's basket draft if any.
4. Classify the fall with sources: structural (credit event, war, policy shock) or sentiment/technical. Structural means preserve cash and reassess at close.
5. Stops: only ever widen hold/add stops to the crash floor (use the gtt skill to draft). Never tighten in a fall. Never average down a name whose thesis broke.
6. If no stage is reached or no plan is saved, draft nothing and say so. Never invent tranches.
7. Limit orders only, never market orders in a fast market. Near the close, default to "assess overnight".
8. `log_append` the decision and its reason.
