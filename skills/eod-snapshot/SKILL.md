---
name: eod-snapshot
description: End-of-day portfolio close-out. Use when the user says "EOD analysis", "end of day", "market close summary", or "how did we close". Pulls final prices, computes day P&L, flags positions near SL/target, updates cash status, and sets tomorrow's setup.
---

# EOD Snapshot

Post-close (after 3:30 PM IST) portfolio wrap-up. If run before close, state clearly that prices are intraday, not final.

## Steps

1. Pull `kite:get_holdings`, `kite:get_gtts`, `kite:get_margins` for final prices.
2. Compute: final day P&L (₹ and %), total portfolio P&L, sector-level winners/losers for the day.
3. Flag positions within 3% of an SL or target trigger — these may fire tomorrow.
4. Cash % vs 5–10% target; state gap and the standing restoration path if below.
5. Quick scan of after-market news: results announced post-close for held stocks, US futures direction.
6. Tomorrow's setup: events on calendar (earnings for held stocks, macro releases, expiry), GTTs likely to trigger at open, and whether the cash position supports any planned deployment.

## Output

1. Day P&L line with timestamp (state "final close" or "intraday as of HH:MM")
2. Compact table: top 3 gainers/losers of the day with ₹ P&L
3. Trigger-proximity alerts
4. Cash status line
5. Tomorrow's setup: 2–3 sentences

## Snapshot write

Write the day's snapshot to `portfolio-snapshots/YYYY-MM-DD.json` (same schema as session-open Step 4) so tomorrow's runs have a baseline.

## Rules

- Analysis only — no order placement in this skill.
- If any GTT was cancelled today (check cancellation reasons in GTT objects), flag it prominently: positions may be unprotected overnight.
- Do not extrapolate one day's move into a trend call.
