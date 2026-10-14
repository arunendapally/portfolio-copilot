# Contract: portfolio-core MCP tools

Server name `portfolio-core`, stdio. Every tool accepts optional `folder` (working folder).
Every result is `{ ok, ..., text }` where `text` is a compact markdown rendering the model shows
as is. Errors: `{ ok: false, error, hint }`. Edition `lite` omits `execute_draft`.

| Tool | Input | Output | FR |
|---|---|---|---|
| `broker_status` | none | per broker: `live / needs_login / outage / disabled`, login link only when `needs_login` and only from the broker's login tool | 001-005 |
| `broker_login` | `broker`, `step?: start|validate`, `ucc?` | Kite: link from `login`. Kotak: `start` returns link, `validate` confirms | 002, 006 |
| `refresh` | `brokers?` | pulls all live brokers, writes snapshot, returns totals, alerts, diff vs previous, unverified counts | 007-014 |
| `ingest` | `broker`, `holdings[]` or `csv_path`, `cash?`, `currency?`, `fx_rate?`, `fx_source?` | merges into today's snapshot | 010 |
| `check` | none | consolidated report from the latest snapshot: totals, weights with base, cash vs buffer, alerts, diff, trade audit | 008-014 |
| `gtt_audit` | `corporate_actions?: [{symbol, kind, ratio, ex_date, confirmed}]` | per-symbol findings, crash test, outliers | 015-020 |
| `draft_gtt_plan` | `symbols?` | draft (code, rows) placing first, deleting after | 021, 022 |
| `draft_basket` | `amount` or `stage`, `destinations?` | draft (code, rows), total, cash left, conflicts | 025 |
| `crash_check` | `index_level` | stage reached, stops that fire, widening proposals, basket draft if a stage is reached | 026 |
| `rate_map` | none | holdings grouped by rate sensitivity | 036 |
| `profile_get` | `path?` | profile or sub-tree | 028 |
| `profile_update` | `path`, `value` | updated value, validation errors | 028, 031 |
| `log_append` | `text`, `start_here?` | path written | 030, 031 |
| `execute_draft` | `code` | per-row results; refuses unless approved and unchanged (full edition only) | 023, 024 |

## Error classification (Kite)

| Signal | Status |
|---|---|
| network error, timeout (after one retry), HTTP >= 500 | `outage` |
| tool result `isError` with "log in" or "Failed to" | `needs_login` |
| `get_profile` succeeds | `live` |
