---
name: analyze
description: Fundamentals assessment of one NSE/BSE stock the investor holds or names. Use for "analyze [stock]", "is [stock] worth holding", "fundamentals of [stock]", "should I re-enter [stock]", "setups", "watchlist", "run my screens", "intraday plan", "retro".
---

# Analyze

1. Confirm the stock is held or was named by the investor. If they ask "what should I buy", explain that this tool analyzes their choices and offer to analyze a name they pick.
2. Always delegate: spawn the `fundamentals-analyst` agent (Task tool) with the symbol, whether it is held, and the investor's verdict from `profile_get verdicts.<SYMBOL>`. One agent per stock; several stocks run in parallel. Do not answer inline.
3. Show the agent's report unchanged: keep its format, bracketed source quotes and vintages; do not summarise, reword or add numbers. If the analysis disagrees with a standing verdict, say so and suggest the investor update the verdict; never edit it yourself.
4. If the report's `Data gaps` line names a blocked primary source (Screener.in, NSE/BSE filings), tell the investor this is a **partial analysis** before any stop or exit decision, and do not classify the name against GTT policy rule 5 from it. Offer a re-run once the source is allowed (see README, Guardrails).
5. If the name holds a stop that fails the crash test and the analysis is complete, apply GTT policy rule 5: if the company is weakening, propose `verdicts.<SYMBOL>.stop_review` = `{decision: "keep", at: <today>, reason, review_by: <next results date>}`; if it is sound, propose `{decision: "widen", at, reason}` and the `gtt` skill. Save with `profile_update` only after the investor confirms.
6. `log_append` a one-line summary with the date.

## Setups, watchlist, intraday (charts and levels, never tips)
- "setups": `pc setups` (holdings plus watchlist). A new name shows "Short history" until it has 50 closes: pull daily candles from the Kite MCP for it and pass them to `closes_seed`.
- "watchlist": `pc watchlist` (action list, add, remove). "Run my screens": open each saved screen (`save_screen` keeps its url) in the investor's browser, pass the symbols it returns to `record_results`; show them as screen output, never as picks, then `analyze` any the investor names.
- "intraday plan [stock]": read today's 5-minute candles from the Kite MCP, ask for the risk per trade, call `intraday_plan` with `log: true`. While the investor trades, every N minutes read the quotes and call `intraday_watch`; tell them when a call hits its stop or target. Charges use their saved `charges` rates, else a flagged default.
- "retro": read the day's 5-minute candles for each logged symbol, call `retro`, show its text; on Fridays add the week's play P&L after charges.
