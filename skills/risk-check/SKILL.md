---
name: risk-check
description: Run the portfolio risk and safety checklist across all brokers. Use when the user says "risk check", "portfolio risk", "am I overexposed", "check my cash buffer", "XIRR check", "weekly risk update", "quarterly review", or after any large market move. Evaluates cash buffer, concentration limits, XIRR vs target, and margin health, and issues escalation alerts when thresholds are breached.
---

# Risk Check

Evaluate the consolidated portfolio against hard risk limits. Requires live data — if holdings were not pulled this session, run the session-open pulls first. Read `portfolio-profile.md` for the user's thresholds if it exists, and use `portfolio-snapshots/` history for week-over-week deltas (drawdown from peak, weight drift) instead of relying on memory.

## Thresholds (defaults — user-overridable)

The values below are defaults. If the user has stated different targets — in this conversation, in project knowledge/memory, or by saying e.g. "my XIRR target is 12%" — use the user's values and note the override in the output. Never silently revert to defaults once a user target is known.

| Check | Limit | Severity |
|---|---|---|
| Cash/liquid buffer | 5–10% of portfolio | Below 5% = flag; below 1% = critical, report first |
| Single stock weight | ≤15% | Breach = trim recommendation |
| Single sector weight | ≤30% | Breach = rebalance recommendation |
| Single AMC (MF book) | ≤25% | Breach = SIP redirection recommendation |
| Daily single-stock drop | >5% | Investigate cause before reacting |
| Portfolio XIRR | ≥10% (5-year target) | Below 10% for 3 months = escalation |
| Drawdown from peak | >10% | Escalation |
| Broker margin | ≥0 | Any negative margin = immediate flag |

## Steps

1. Compute weights per stock, sector, and AMC from consolidated (all-broker) values. Compute cash buffer including broker cash and liquid/arbitrage funds.
2. **XIRR — only with a real data path.** XIRR needs dated cash flows; no live tool exposes full history. Follow this order: (a) pull whatever `kite:get_trades`/order history covers and say which period it spans; (b) ask for a tradebook export and/or CAMS/KFintech CAS upload (via the import-statements skill) for the rest; (c) compute XIRR programmatically in Python from the combined dated flows — never estimate it mentally. If the user declines to provide history, SKIP the XIRR row entirely and report simple absolute/annualized return clearly labeled as such — do not call anything XIRR without cash-flow data.
3. Benchmark: compare against Nifty 50 TRI over the same period (web search for current values).
4. Stress note: state portfolio impact of a 10% Nifty drop and a 20% drop in the largest sector.

## Output

1. Traffic-light table: `Check | Current | Limit | Status`
2. Breaches ordered by severity, each with one concrete corrective option (trim candidate, SIP redirect, buffer restoration path)
3. Executive summary: 2–3 sentences, XIRR vs target first

## Weekly deep metrics (when user says "weekly risk update")

Add to the standard checks:

1. **Portfolio beta** vs Nifty 50 (target band 0.8–1.2) — compute from holdings' betas weighted by value; state the source of beta figures.
2. **Max drawdown** from portfolio peak (flag >15%).
3. **Largest-position VaR**: approximate 1-day 95% VaR of the biggest holding as % of portfolio (flag >3%).
4. **Correlation clusters**: flag pairs/groups of holdings >30% correlated that jointly exceed sector limits (e.g., PSU banks moving as one position).
5. **Weakest-holdings review**: identify the 2–3 existing holdings with the weakest fundamentals/technicals (delegate each to the fundamentals-analyst agent) so the user can decide whether they still belong. Analyze only what the user holds — never scan for or suggest new stocks to buy.

## Quarterly review (when user says "quarterly review")

1. 13-week rolling XIRR vs target.
2. Top 3 winners and losers of the quarter — one-line attribution each (thesis worked / luck / macro).
3. Sector over/underweight review for next quarter.
4. Macro thesis validation: what was assumed last quarter vs what happened.
5. Lessons learned — concrete rule changes to propose (threshold adjustments, watchlist changes).

Keep the quarterly output under one page; it is a decision document, not a report.

## Escalation

If XIRR is below target sustained or drawdown >10% from peak, present corrective options explicitly: rebalance sectors, increase SIPs into core growth funds, exit underperformers, or add diversification. Restoring the cash buffer is a prerequisite before recommending any new deployment.

## Rules

- Recommendations must include stop-loss and target levels where applicable.
- Never auto-execute anything; this skill is analysis only.
- Wealth-preservation framing: balance growth assets with stable blue chips, sized to the user's saved risk profile.
