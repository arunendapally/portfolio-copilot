# Data Model: v0.5

All files live in `<working folder>/portfolio-copilot/` unless noted. Money is INR unless a
`currency` field says otherwise. Times are ISO-8601 with offset (IST for display).

## Profile (`profile.json`)

```json
{
  "schema_version": 1,
  "investor": { "goal": "", "horizon_years": 15, "risk": "balanced", "return_target_pct": 10 },
  "brokers": { "kite": { "enabled": true }, "kotak": { "enabled": false, "ucc": "" }, "ibkr": { "enabled": false } },
  "cash": { "buffer_min_pct": 5, "buffer_max_pct": 10, "buffer_location": "broker" },
  "limits": { "single_stock_pct": 15, "sector_pct": 30, "fund_house_pct": 25 },
  "allocation": { "targets": {}, "symbol_buckets": {} },
  "gtt_policy": {
    "etf_stop": false, "crash_floor_pct": 25, "min_stop_distance_pct": 20,
    "crash_test_pcts": [10, 20], "exit_verdict_stop": false, "etf_symbols": []
  },
  "verdicts": { "SYMBOL": { "stance": "hold", "reason": "", "exit_level": null, "review_date": null } },
  "sectors": { "SYMBOL": "financials" },
  "rate_overrides": { "SYMBOL": "most" },
  "deployment_plan": {
    "index": "NIFTY 50", "corpus_inr": null,
    "stages": [ { "level": 23500, "share_pct": 25 } ],
    "destinations": [ { "symbol": "NIFTYBEES", "exchange": "NSE", "weight_pct": 30 } ]
  }
}
```

Rules: `stance` in `hold | add | hold_no_add | reduce | exit`. Missing verdict = `hold`.
`buffer_location` in `broker | bank`; when `bank`, broker cash is deployable. Unknown keys are
kept. Validation errors name the path. Defaults fill missing keys on load.

## Holding (normalized, inside a snapshot)

`{ broker, symbol, exchange, isin, type: equity|etf|mf|foreign, qty, avg, ltp, value, pnl,
day_change, currency, fund_house?, folio? }`

ETF detection: `gtt_policy.etf_symbols`, else symbol matches `BEES$|ETF$|IETF$|^MON100$` or the
broker marks it.

## GTT (normalized)

`{ id, broker, symbol, exchange, type: single|two-leg, status, triggers: number[], legs:
[{ side, qty, price }], created_price, created_at }`. `created_price` is never used for proximity.

## Snapshot (`snapshots/YYYY-MM-DD.json`, last 30 kept)

`{ taken_at, brokers: { <name>: { status, as_of, cash, holdings[], gtts[], orders[], trades[],
mf_folio_count } }, fx: { USDINR?: { rate, source, as_of } }, unverified: { <check>: count } }`

## Draft (`drafts/<code>.json`)

`{ code, kind: gtt_plan|basket, created_at, rows[], status: draft|approved|executed|expired,
approved_at?, approved_hash?, results? }`. Code = `D` + 4 chars from `[A-HJ-NP-Z2-9]`.
Rows (gtt_plan): `{ step, action: place|delete, symbol, exchange, gtt_id?, type, triggers[],
legs[], reason }`. Rows (basket): `{ symbol, exchange, qty, limit_price, amount, basis }`.
Approval is valid 24 h and only while `sha256(rows)` equals `approved_hash`.

## Log (`log.md` + `log/YYYY-MM.md`)

`log.md` = `## Start here` block (rewritten) + current month's dated entries. On first write
in a new month, previous months move to `log/YYYY-MM.md`.

## Session store (`~/.portfolio-copilot/sessions.json`, mode 0600)

`{ kite: { mcp_session_id, created_at, authorised_at? }, kotak: { sessionid, ucc, created_at,
validated_at? }, last_folder }`
