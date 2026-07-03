---
name: crash-protocol
description: Emergency playbook for sharp market falls. Use when the user says "crash mode", "market is crashing", "Nifty is down big", or when a session reveals Nifty down more than 5% intraday or 10%+ from recent peak. Triages stop-losses, computes deployable cash, and builds a staged response plan — deliberately, not in panic.
---

# Crash Protocol

Structured response to a sharp fall. The goal is to prevent both panic-selling and blind dip-buying.

## Step 1 — Triage (first, fast)

1. Pull `kite:get_holdings`, `kite:get_gtts`, `kite:get_margins` immediately.
2. List positions where SL GTTs have FIRED today (check order status) — these are done; no second-guessing.
3. List positions within 3% of SL — likely to fire; for each, one-line call: let it fire (thesis broken) or review SL (panic-driven wick).
4. Compute deployable cash across brokers.

## Step 2 — Classify the fall

Search for the cause before any deployment talk: structural (credit event, war, policy shock) vs sentiment/technical (positioning unwind, single-stock contagion, F&O expiry). State the classification and confidence. Structural = preserve cash, no deployment. Sentiment = staged deployment becomes discussable.

## Step 3 — Response plan

Only if classification supports it:

1. Analysis of names the USER already holds or has explicitly put on their watchlist — current price vs their stated levels, with data. Never originate new stock picks; if the user asks "what should I buy", explain that this tool analyzes their choices rather than making picks, and offer to analyze any name they select.
2. Staged deployment: split available cash into 2–3 tranches gated on levels or events (never all at once). Respect the rule that the 5–10% buffer is restored before/alongside deployment, not consumed to zero.
3. Tightening review: winners whose gains are at risk — propose trailed SLs.

## Output

1. One-line status: index move, portfolio day P&L, fired SLs count
2. Triage table: `Position | Status (fired/near-SL/safe) | Action | Reason`
3. Classification verdict with sources
4. Staged plan (only if warranted) or explicit "preserve cash, reassess at close"

## Rules

- Never recommend market orders in a fast market — limit/GTT only, with stated levels.
- All executions still require per-order confirmation (hook-enforced).
- If the fall is near clos