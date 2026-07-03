---
name: gtt-audit
description: Audit and maintain GTT orders on Zerodha. Use when the user says "audit GTTs", "check my GTTs", "GTT review", "are my positions protected", or after any corporate action, dividend, or session open reveals GTT gaps. Finds orphans, silent cancellations, unprotected holdings, and stale triggers; drafts corrections but never executes without explicit confirmation.
---

# GTT Audit

Ensure every material position has correct, active GTT protection and no orphan orders exist.

## Step 1 — Pull current state

Call `kite:get_gtts` and `kite:get_holdings` in parallel. Get LTPs for held stocks via `kite:get_ltp` (batch carefully; avoid quote/ohlc tools for 5+ instruments).

## Step 2 — Classify every GTT and holding

Check for, in priority order:

1. **Silent cancellations**: GTTs cancelled by corporate actions (dividends, splits). The cancellation reason is returned in the GTT object itself. These leave positions unprotected — flag first.
2. **Unprotected holdings**: positions above ₹50K market value with no active stop-loss GTT.
3. **Orphan GTTs**: GTTs on stocks no longer held. Recommend deletion.
4. **Duplicates**: more than one active GTT per stock per strategy. Recommend consolidation to a single two-leg (OCO) GTT.
5. **Stale triggers**: stop-losses far below current price on winners (candidate for trailing up), or triggers already breached/unreachable.
6. **Quantity mismatches**: GTT quantity ≠ current holding quantity (partial exits, bonus shares).

## Step 3 — Report

Output one table: `Stock | Current GTT | LTP | Suggested Action | Reason`. Include rows with "OK — no change" only in a count, not the table.

For each suggested new or modified GTT, prefer two-leg (SL + target) structures and state exact trigger prices, quantities, and order type.

## Execution rule (mandatory)

Claude may place, modify, or delete GTTs via Kite MCP, but MUST:

1. Show the exact order details (instrument, trigger price(s), quantity, transaction type, product).
2. Receive explicit user confirmation for each placement, modification, or deletion.
3. Never batch-execute on a blanket "yes" — confirm deletions and placements as distinct groups at minimum.

After execution, re-pull `kite:get_gtts` and confirm the final state matches intent.
