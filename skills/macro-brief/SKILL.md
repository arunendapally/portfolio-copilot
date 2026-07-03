---
name: macro-brief
description: Assess global macro context before any market-open or positioning call. Use when the user says "market brief", "macro check", "how are markets looking", "should I deploy today", or before Claude makes any intraday, short-term, or deployment-timing comment. Pulls overnight US close, Asian opens, GIFT Nifty, and key events via web search.
---

# Macro Brief

Ground every positioning or timing comment in current global context. Global macro overrides domestic positives — a domestic tailwind (e.g., RBI action) does not justify optimism if US markets sold off sharply overnight.

## Data to gather (web search, parallel where possible)

1. **US close**: S&P 500, Nasdaq, Dow — % change and driver (Fed, earnings, data print).
2. **Asian session**: Nikkei, Hang Seng, Kospi current/opening moves.
3. **GIFT Nifty**: level and implied Nifty open.
4. **Risk gauges**: US 10Y yield, dollar index, Brent crude, USD/INR.
5. **Flows**: latest FII/DII net figures.
6. **Event calendar**: Fed/RBI decisions, major data releases, expiry days within the next week.

Search for the most recent data available; state timestamps. If markets are mid-session, use live levels, not previous close.

## Output

1. One-line read first: risk-on / neutral / risk-off for Indian open, with the single dominant driver. This is a read of observed conditions, NOT a direction forecast.
2. **Setup over forecast**: never predict market direction. Give the setup instead — key index levels (support/resistance, max OI where relevant), today's catalysts, and probability-weighted scenarios the user can judge. Separate the base case from tail risk explicitly.
3. Compact table of the levels above with % changes, each tagged with a confidence level: live / 1-2 days old / older. Cite the source for each claim (exchange data, news article + date).
4. Implications: 2–3 sentences on what this means for pending actions (GTT triggers likely to fire, deployment tranches gated on macro events, sectors exposed to the overnight move).

Structure for voice comprehension: verdict and numbers first, detail after.

## Rules

- Never make an intraday or short-term positioning comment without this context from the current session.
- If a pending deployment is gated on a specific event (e.g., a Fed decision), report that event's outcome or schedule explicitly before discussing the deployment.
- Do not present a forecast as fact; distinguish observed moves from implied expectations.
- Never forecast market direction — nobody can do it reliably. Present the setup instead: key levels, catalysts, and probability-weighted scenarios, separating the base case from tail risk explicitly.
- Consistency self-check: before presenting, verify the one-line verdict against every level in the table. A risk-on verdict with a sharp overnight US selloff in the same output is a contradiction — resolve it first.
- Cite the source and date for each claim (broker feed vs news article vs data release).
