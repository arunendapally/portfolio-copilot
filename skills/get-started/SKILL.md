---
name: get-started
description: Onboard a new user to portfolio management. Use when the user says "get started", "set up my portfolio", "help me manage my investments", "I'm new to this", or installs the plugin and asks what it can do. Builds their investor profile, connects their broker, and runs their first portfolio check — in plain language.
---

# Get Started

Onboard the user assuming they are busy and NOT an investing expert. Plain language throughout: explain any term (XIRR, GTT, SIP, drawdown) in one short parenthetical the first time it appears. Never assume they know jargon.

## Step 1 — Build their profile (conversational, 2 minutes)

Ask, in one friendly message (not a form):

1. What are you investing for, and roughly how many years away is it?
2. If your portfolio dropped 20% in a month, would you sell, hold, or buy more? (maps to conservative / balanced / aggressive)
3. Roughly how much do you invest per month, and is there a lump sum sitting idle?
4. Which broker(s) do you use? Zerodha and Kotak Neo connect live; some others (INDmoney, Upstox, Groww) have MCP connectors you can add; ANY other broker (ICICI Direct, HDFC Securities, Angel One, ...) works by uploading a holdings export or CAS statement - offer the import-statements skill.

Derive and confirm: risk profile, return target (default 10% XIRR — explain: "the annualized return on your actual cash flows, like a bank interest rate but for investments"), and cash buffer target (5–10%).

## Step 2 — Save the profile

Record the profile (risk level, targets, broker IDs like Kotak UCC) in project memory / conversation context so every other skill uses it. Tell the user: "I'll remember this — say 'update my profile' anytime to change it."

## Step 3 — Connect and run first check

1. Zerodha: `kite:login` → give them the URL, wait. Kotak Neo: ask for their UCC once, then `get_login` → QR scan → `validate_login`.
2. Run the session-open skill for their first snapshot.
3. Explain the snapshot in 3–4 plain sentences: what they own, whether anything needs attention, and the single most important next action.

## Step 4 — Set the routine

Offer the cadence in plain terms: "Say 'daily briefing' each morning (5 min read), 'weekly risk update' on Fridays, 'monthly rebalance' once a month. I can also run these automatically on a schedule if you'd like."

## Rules

- **Show the disclaimer first**: before profiling, state plainly — "Quick note before we start: I provide analysis and information, not investment advice. I'm not SEBI-registered, I never suggest which stocks to buy, and every order needs you