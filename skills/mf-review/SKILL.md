---
name: mf-review
description: Review the mutual fund book across Zerodha Coin and Kotak Neo against a model portfolio for the user's risk profile. Use when the user says "review my MFs", "mutual fund check", "SIP review", "AMC concentration", or asks whether to stop, start, or resize any SIP. Checks AMC concentration, ELSS sprawl, SIP quality, and drift from target.
---

# MF Review

Rationalize the mutual fund book toward the target structure and flag structural risks.

## Target structure (by risk profile)

Use the user's saved risk profile (from get-started). If none exists, run that profiling first. The core principle: 4–6 funds, one per category, each from a DIFFERENT AMC (fund house), no overlapping mandates.

| Category | Conservative | Balanced | Aggressive |
|---|---|---|---|
| Large-cap index (Nifty 50/100) | 35% | 25% | 20% |
| Flexi cap | 25% | 25% | 25% |
| Mid cap | — | 15% | 20% |
| Small cap | — | — | 15% |
| Multi asset / hybrid | 25% | 25% | 20% |
| Debt / liquid | 15% | 10% | — |

For categories the user needs to fill, present an information shortlist — the top publicly-ranked schemes per category (rolling returns, consistency, AUM, expense ratio) from live sources with citations — and let the user choose. Frame it as "here is what public rankings show", never "buy this fund". If the user already holds a well-ranked fund in a category, keep it rather than churn. Everything outside the target structure is a consolidation candidate unless it is a deliberate, user-confirmed bet.

## Step 1 — Pull holdings

Zerodha: `kite:get_mf_holdings`. Kotak Neo: MF folios come inside `kotak-neo:get_holdings`. Infer active SIPs from unit accumulation patterns (no SIP API exists).

## Step 2 — Analyze

1. **AMC concentration**: compute % of total MF value per AMC across ALL brokers combined — concentration often hides across accounts. Flag any AMC above 25% and explain why it matters (one fund house's process/team problems would hit too much of the portfolio at once).
2. **ELSS sprawl**: list all ELSS (tax-saving) schemes; multiple ELSS funds serving the same 80C purpose is consolidation-eligible (respect 3-year lock-ins per lot before recommending exits).
3. **Drift vs target**: map each holding to the model structure; classify as core / consolidate / dust (below ₹5K) / deliberate bet.
4. **SIP quality**: for schemes receiving fresh SIPs, check category ranking and rolling returns via web search (Value Research, Morningstar). Flag bottom-quartile funds.
5. **TER verification**: Coin's live TER is authoritative over aggregators (they snapshot at different dates). Search Coin using SEBI-standardized fund names (e.g., "Canara Robeco Large Cap Fund", not "Bluechip").

## Step 3 — Report

Output:

1. Holdings table: `Scheme | AMC | Broker | Value | SIP? | Classification`
2. AMC concentration table with flags
3. Numbered action list (stop/start/resize SIP, consolidate, resolve dust) — each with rationale and any lock-in constraint

## Rules

- Never draft redemption or SIP-change orders — MF actions are recommendations only; the user executes on Coin/Kotak.
- Verify fund data against at lea