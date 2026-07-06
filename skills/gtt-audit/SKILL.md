---
name: gtt-audit
description: Audit and maintain GTT orders on Zerodha. Use when the user says "audit GTTs", "check my GTTs", "GTT review", "are my positions protected", or after any corporate action, dividend, or session open reveals GTT gaps. Finds orphans, silent cancellations, unprotected holdings, and stale triggers; drafts corrections but never executes without explicit confirmation.
---

# GTT Audit

Ensure every material position has correct, active GTT protection and no orphan orders exist.

## Step 1 — Pull current state

Call `kite:get_gtts` and `kite:get_holdings` in parallel. `get_gtts` payloads can exceed 50K characters: immediately reduce to {symbol, type, trigger(s), qty, status, cancellation reason} and work only from the reduced table — never re-print the raw blob. If truncated, or for portfolios with 30+ GTTs, save the raw response to a temp file immediately and parse it programmatically (Python) instead of processing it in-context — then work from the parsed table. Get LTPs for held stocks via `kite:get_ltp` (batch carefully; avoid quote/ohlc tools for 5+ instruments).

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

## Auto-created bracket GTTs (critical correctness rule)

Kite buy orders can auto-place an OCO bracket GTT at execution time (visible as `gttp` in the order's `meta`, e.g., a -8%/+15% pair). Consequence: a symbol traded today may ALREADY have a fresh GTT you don't know about. Therefore, before modifying or creating any GTT for a symbol that had an order today, re-fetch `get_gtts` and check for MULTIPLE GTTs on that symbol. Never assume one GTT per symbol. If two GTTs jointly cover more shares than held (double coverage), flag it — whichever triggers first would cause a rejected or partial order — and propose consolidation.

## Execution rule (mandatory)

Claude may place, modify, or delete GTTs via Kite MCP, but MUST:

1. Show the exact order details (instrument, trigger price(s), quantity, transaction type, product).
2. Receive explicit user confirmation for each placement, modification, or deletion.
3. Never batch-execute on a blanket "yes" — confirm deletions and placements as distinct groups at minimum.

After execution, re-pull `kite:get_gtts` and confirm the final state matches intent.
