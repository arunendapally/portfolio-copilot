---
name: daily-briefing
description: Run the pre-open or intraday portfolio briefing. Use when the user says "daily briefing", "morning briefing", "mid-day check", "afternoon check", or "execute entries". Combines macro pull, live holdings, GTT trigger proximity, and a one-line verdict — timestamped. For "execute entries", additionally verifies pre-planned trades against live prices and news before drafting orders.
---

# Daily Briefing

Read `portfolio-profile.md` (thresholds, brokers) and the latest `portfolio-snapshots/` entry (comparison baseline) from the working folder first, if they exist. Front-load all broker login prompts in one message; daily session expiry is normal — say so, don't apologize for it.

Fast, timestamped market-and-portfolio readout. Target: readable in 5 minutes, structured for voice.

## Mode 1 — Briefing ("daily briefing", "mid-day check", "afternoon check")

1. **Macro (parallel web searches)**: US overnight close, Asian session, GIFT Nifty (pre-open) or live Nifty (intraday), Brent crude, USD/INR, today's earnings/events calendar (BSE), any Fed/RBI items.
2. **Portfolio (parallel MCP pulls, ALL asset classes)**: equities AND mutual funds together — never equities only. `kite:get_holdings`, `kite:get_mf_holdings`, `kite:get_margins`, `kite:get_gtts`; Kotak holdings (includes MF folios) when connected; any other connected broker's positions. Convert non-INR accounts to INR at the day's exchange rate and state the rate used.
3. **Compute**: day P&L so far, cash % vs 5–10% target, GTTs within 2% of their trigger (list stock, trigger, LTP, distance).
4. **Trade audit**: pull today's orders/trades and diff every executed trade — including ones placed directly in the broker app — against standing per-symbol verdicts, the cash-buffer floor, and concentration caps (see session-open Step 3.5). Flag contradictions unprompted.
4. **Timestamp every data point** (HH:MM IST). Flag anything older than 4 hours as stale.

Output order: one-sentence verdict first (e.g., "Risk-off open likely, cash at X%, no GTTs near trigger") → macro table → P&L line → GTT proximity alerts → today's events.

## Scheduled / non-interactive runs

When run by a scheduled task with the user absent: do NOT stall on broker logins. Present the login link(s) for expired sessions, then deliver what needs no auth — the macro read plus last-known portfolio context from the latest `portfolio-snapshots/` entry (clearly dated as such) — and state plainly which parts are held pending re-login. A partial briefing on time beats a complete briefing never.

## Close-out (every briefing)

1. Save the full readout as a dated file: `PortfolioReviews/YYYY-MM-DD-daily-briefing.md` in the working folder (create the folder if missing). Complete content, not a summary — this is the durable per-day record.
2. Append a dated one-paragraph entry to `progress.md`: what was pulled, consolidated total, what changed since the last run.
3. If a standing verdict was contradicted by a live trade or a review-date item came due, note it in `progress.md` — never silently edit the user's verdicts.

## Mode 2 — Execute entries ("execute entries")

Only for entries the user has already planned. For each:

1. Verify live price vs planned entry (`kite:get_ltp`). Flag gaps beyond 1%.
2. Search for breaking news on the stock (earnings, regulatory, corporate action) — reject the entry if material adverse news exists, with the source.
3. Confirm or reject each trade with a one-line data-backed reason.
4. Draft the GTT/order with entry, SL, and target levels and stated basis.
5. **Decision journal**: append each confirmed entry to `decisions.md` in the working folder — date, symbol, thesis (one line), entry, SL, target, and the basis for each level. Capture this at the moment of intent, not after the fact. If a user later asks to move a target with no price-action basis (e.g., to hit a round profit number), point back to the journaled level and ask what changed.

Execution follows the standard rule: exact details shown → explicit per-order confirmation → then place via MCP. (The plugin's PreToolUse hook enforces this.)

## Rules

- **Consistency self-check before presenting**: re-read the verdict against every data point pulled. If any major datapoint contradicts it (e.g., a bullish verdict while US markets closed sharply down, or "deploy" while cash is below buffer), resolve the contradiction or lead with it — never present a verdict the data on the same page argues against.
- Never invent pre-planned entries; if none were given, ask for the list.
- Global macro overrides domestic positives — verdict must reflect the weaker of the two.
- No deployment suggestions while cash buffer is below 5% unless the user overrides.
- Mid-day/afternoon runs: additionally flag positions that hit SL or target intraday and ask whether the thesis is intact before suggesting action.
