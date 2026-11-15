# Data model: 002-guided-review

All files are JSON, written through `state.writeJson` (atomic, throws on failure). Symbols in examples are made up.

## 1. Profile additions (`profile.json`, `schema_version` 1 -> 2)

Migration: on load, a version 1 profile gets the defaults below and is saved as version 2 on the next `profile_update`. Nothing existing is renamed.

```json
{
  "schema_version": 2,
  "classes": { "ALPHA": "play", "GAMMAETF": "core" },
  "sectors": { "ALPHA": "financials", "BANKETF": "financials" },
  "limits": {
    "single_stock_pct": 15, "sector_pct": 30, "fund_house_pct": 25,
    "sector_base": "kite_listed"
  },
  "allocation": {
    "targets": { "india_equity": 60, "global_equity": 20, "gold": 10, "debt": 5, "cash": 5 },
    "bands_pp": { "india_equity": null, "global_equity": null },
    "symbol_buckets": { "ARBFUND": "cash" }
  },
  "gtt_policy": {
    "profit_lock": {
      "enabled": false, "scope": "play",
      "arm_gain_pct": null, "book_gain_pct": null, "book_fraction_pct": null,
      "trail_pct": null, "reentry_cooloff_days": null,
      "proceeds_to": null
    }
  },
  "verdicts": {
    "ALPHA": {
      "stance": "hold_no_add", "reason": "…",
      "tripwires": [
        { "id": "margin", "metric": "ebitda_margin_pct", "below": 20, "for_quarters": 2 },
        { "id": "growth", "metric": "sales_growth_yoy_pct", "below": 0 }
      ],
      "on_tripwire": "exit",
      "next_results": "2027-02-10"
    }
  },
  "plan": {
    "start": "2026-01-01", "start_book_inr": null, "return_pct": null,
    "monthly": [{ "from": "2026-12", "amount_inr": null }],
    "step_up_pct": null, "step_up_month": null,
    "behind_tolerance_pct": null
  },
  "reentry": [{ "symbol": "DELTA", "exited_at": "2026-06-15", "by": "manual", "needs": "fresh thesis" }],
  "loss_tolerance": { "amount_inr": null, "from": null, "to": null, "measure": null },
  "tax": { "as_of": null, "ltcg_exemption_inr": null, "ltcg_pct": null, "stcg_pct": null, "fy_start_month": 4 },
  "valuation_overrides": { "FROZENCO": 0 },
  "log": { "path": null },
  "review": { "max_tasks": 5, "readback_after_days": 28 }
}
```

Validation rules (add to `profile.validate`):

- `classes.*`: `core` or `play`. Default when absent: funds (`etf`, `mf`, `foreign`) are core, `equity` is play.
- `limits.sector_base`: `direct_equity` (today's behaviour) or `kite_listed` (stocks and funds listed at the primary broker) or `book`.
- `allocation.bands_pp.*`: number > 0 or null. Null means the drift rule is "not set" for that bucket (FR-037).
- `profit_lock`: `enabled` may be true only when all five numbers are set; `0 < arm_gain_pct < book_gain_pct`; `0 < book_fraction_pct < 100`; `trail_pct > 0`; `scope` is `play` or `all_stocks`.
- `tripwires[*]`: `metric` from the list in [contracts/pc-commands.md](contracts/pc-commands.md) (research_submit); exactly one of `below` / `above`; `for_quarters` integer >= 1, default 1.
- `on_tripwire`: `exit`, `reduce` or `review`.
- `loss_tolerance.measure`: `realised` or `realised_plus_open` or null (open decision 2).
- `tax.*`: all null until the investor confirms; `as_of` required once any is set.
- `log.path`: a file name inside the investor folder, or null for `portfolio-copilot/log.md`.

## 2. Snapshot additions (`snapshots/<date>.json`)

Per holding: `price_as_of` (ISO time or date the price refers to), `price_source` (`kite`, `kotak`, `ibkr`, `kite_for_kotak`), `day_qty` (same-day buys included in `qty`), `frozen` (bool), `class`.

Per broker block: `cash_status` (`ok` | `unknown`), `positions` (normalised same-day positions).

Top level: `technicals` (US7 only): `{ "ALPHA": { "dma50": 0, "dma200": 0, "rsi14": 0, "as_of": "…" } }`.

## 3. Marks (`marks.json`)

```json
{
  "schema_version": 1,
  "symbols": {
    "ALPHA": {
      "since": "2026-11-12", "high_close": 0, "high_at": "2026-11-12",
      "stage": "idle", "stage_at": null,
      "booked_qty": 0, "last_stop": null, "source": "snapshot"
    }
  }
}
```

- Updated at the end of the pull stage from the snapshot's close; `high_close` only rises. `source` is `snapshot` or `backfill` (US7 price history).
- Stage transitions (only forward, except reset to `idle` when the holding is fully sold):
  `idle -> armed` when gain over average cost >= `arm_gain_pct` and the armed stop is in place; `armed -> booked` when the booking order is confirmed; `booked -> trailing` at the next run; `armed -> trailing` when `book_fraction_pct` is not used (not possible in v0.9; all values are required).
- A confirmed corporate action re-bases `high_close` and `last_stop` by the price factor.

## 4. Run (`runs/<date>-<kind>.json`)

```json
{
  "schema_version": 1, "id": "2026-11-13-full", "kind": "full", "date": "2026-11-13",
  "started_at": "…", "closed_at": null, "unattended": false,
  "profile_hash": "…", "rules_frozen": true,
  "stage": "propose",
  "stages": {
    "connect": { "status": "passed", "at": "…", "skipped_brokers": [] },
    "pull": { "status": "passed", "at": "…", "snapshot": "2026-11-13" },
    "research": { "status": "passed", "brief": [], "findings": [] },
    "evaluate": { "status": "passed", "task_ids": [], "also_due": 0, "not_set": [] }
  },
  "tasks": []
}
```

`stage` is one of `connect, pull, research, evaluate, propose, execute, verify, record, closed`. `stages.*.status` is `pending | passed | failed | waiting`. A failed gate stores `reason` and `needs`.

## 5. Task (inside a run; also the journal record)

```json
{
  "id": "t_9f2c…", "kind": "profit_lock_arm", "symbol": "ALPHA", "priority": 2,
  "title": "Raise ALPHA stop to cost",
  "why": {
    "rule_ref": "gtt_policy.profit_lock.arm_gain_pct",
    "measurements": [
      { "name": "gain_over_cost_pct", "value": 0, "base": "average cost", "as_of": "…" },
      { "name": "stop_vs_cost_pct", "value": 0, "base": "average cost", "as_of": "…" }
    ],
    "findings": []
  },
  "options": [
    { "id": "do", "label": "Raise the stop to cost", "effects": { "tax": null, "allocation": [], "concentration": [] }, "draft_kind": "gtt_plan" },
    { "id": "nothing", "label": "Do nothing" }
  ],
  "executor": "plugin", "urgency": "this_week", "needs_fresh": ["kite"],
  "decision": null, "decided_at": null, "reason": null, "defer_until": null,
  "draft_code": null, "manual_steps": null,
  "outcome": null, "verified_at": null, "expect": { "kind": "gtt_stop", "symbol": "ALPHA", "stop_gte": 0, "qty": 0 }
}
```

- `kind`: `gtt_gap`, `gtt_policy`, `profit_lock_arm`, `profit_lock_book`, `profit_lock_trail`, `tripwire`, `limit_stock`, `limit_sector`, `limit_fund_house`, `drift`, `contribution`, `reentry_flag`, `tax_budget`, `data` (for example "set your profit-lock values").
- `priority`: 1 safety (`gtt_gap`, `gtt_policy`, `tripwire` with `on_tripwire: exit`), 2 profit lock, 3 other tripwires, 4 limits, 5 drift, 6 contribution, 7 tax and data.
- `executor`: `plugin | investor | blocked`. `decision`: `approved | deferred | declined`. `outcome`: `executed | handed_over | blocked | not_confirmed | confirmed`.
- `expect` is what verification checks after a fresh read. Kinds: `gtt_stop`, `gtt_qty`, `gtt_target`, `holding_qty`, `none` (decisions with no broker effect).

## 6. Finding (inside a run; submitted by `research_submit`)

```json
{ "symbol": "ALPHA", "metric": "ebitda_margin_pct", "value": 0, "period": "Q2 FY27",
  "source_url": "https://…", "source_quote": "…", "accessed": "2026-11-13", "status": "found" }
```

`status`: `found | not_found | blocked_source`. A finding without `source_url`, `period` and `accessed` is rejected. `not_found` and `blocked_source` satisfy the research gate but can never trigger a tripwire.

Accepted findings are also appended to `findings.jsonl` (one line each, with `run_id`), so a tripwire with `for_quarters: 2` can see the previous period's value. For the same symbol, metric and period, the latest accepted finding wins.

## 7. Journal (`journal.jsonl`)

One line per decided task: the task record plus `run_id`. Append-only. The Friday read-back joins lines older than `review.readback_after_days` with current measurements for the same symbol and rule.

## 8. State bundle

```json
{ "schema_version": 1, "exported_at": "…", "source": "pc|cloud",
  "manifest": { "portfolio-copilot/profile.json": "sha256…" },
  "files": { "portfolio-copilot/profile.json": "…content…" } }
```

Files included: profile, the last two snapshots, drafts with status `draft` or `approved` and their `.used` markers, today's runs, `marks.json`, the last 200 journal lines, the "Start here" block and last 50 lines of the log. Size target: under 150 KB.

## 9. Lots (`lots.json`, US8)

```json
{ "schema_version": 1, "built_at": "…", "sources": ["tradebook.xlsx", "coin-statement.csv"],
  "symbols": { "ALPHA": { "lots": [{ "date": "2025-06-02", "qty": 0, "cost": 0 }], "reconciled": true, "held_qty": 0 } },
  "realised": { "fy": "2026-27", "stcg_inr": 0, "ltcg_inr": 0 } }
```

## 10. Per-machine files (`~/.portfolio-copilot/`)

- `captured/<broker>/<cap>.json`: as today, named by capability. Record: `{ tool, mode, at, ok, login, partial, text }`.
- `gaps-pending.json`: `[{ title, attempted, missing, output, at }]`, drained by `report_gap --flush` when a token works.
