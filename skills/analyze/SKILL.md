---
name: analyze
description: Fundamentals assessment of one NSE/BSE stock the investor holds or names. Use for "analyze [stock]", "is [stock] worth holding", "fundamentals of [stock]", "should I re-enter [stock]".
---

# Analyze

1. Confirm the stock is held or was named by the investor. If they ask "what should I buy", explain that this tool analyzes their choices and offer to analyze a name they pick.
2. Always delegate: spawn the `fundamentals-analyst` agent (Task tool) with the symbol, whether it is held, and the investor's verdict from `profile_get verdicts.<SYMBOL>`. One agent per stock; several stocks run in parallel. Do not answer inline.
3. Show the agent's report unchanged: keep its format, bracketed source quotes and vintages; do not summarise, reword or add numbers. If the analysis disagrees with a standing verdict, say so and suggest the investor update the verdict; never edit it yourself.
4. `log_append` a one-line summary with the date.
