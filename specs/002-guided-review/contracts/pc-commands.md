# Contract: engine commands (`pc.js`)

Invocation is unchanged: `node core/bin/pc.js <command> --folder <dir> [--key value] [--json '{...}']`. Every command returns `{ ok, ..., text }`; the model shows `text` as is. `ok: false` always carries `error` and a `text` that says what to do next. Exit code 1 when `ok` is false.

Existing commands keep their arguments. Changes to them are listed at the end.

## Conventions

- `next`: an ordered list of steps the model must take before calling the engine again. Each step is one of:
  - `{ "do": "call", "tool": "<name from the tool map>", "args": {…}, "why": "…" }` — a broker or other tool call, with exact arguments.
  - `{ "do": "ask", "question": {…AskUserQuestion payload…}, "then": "task_decide" }` — ask the investor and pass the answer to the named command.
  - `{ "do": "manual", "steps": ["…", "…"], "then": "task_done" }` — the investor acts; wait for "done".
  - `{ "do": "research", "brief": [ … ], "then": "research_submit" }` — look things up, submit findings.
  - `{ "do": "todoist", "ops": [ … ] }` — apply with the Todoist tools if present; skip silently if not.
  - `{ "do": "files", "op": "writeback", "files": [ … ] }` — copy files to the investor's computer through the device link.
  - `{ "do": "dashboard", "files": [ … ], "then": "review_next with record.dashboard = updated (or skipped)" }`: load the dashboard files the record stage wrote, then report back.
- Optional step fields: `task` (the task id the step belongs to); `only_if` (on a `call`: make it only when the investor picked that exact answer, for example `Yes, place D7`); `then: "calls"` (on an `ask`: the answer gates the `call` steps that follow, not an engine command).
- At execute, an approved plugin task gives one `ask` with `then: "calls"` naming the draft code, then one `call` per unused draft row with `only_if: "Yes, place <code>"` (code: `core/lib/review.js`, stage `execute`).
- `text` is at most 40 lines. Longer detail goes in fields, not text.
- Times are ISO strings; amounts are INR unless a currency is named; every percentage in `text` names its base.

## doctor (US1)

Args: `tools` (array of tool names present in the chat, required).

Returns `{ ok, brokers: [{ broker, enabled, read_path, write_path, generation, unknown: [] }], text }`.

`text` example: `kite: read ok, write ok (generation 2) · kotak: read ok (read-only broker) · ibkr: read ok, write ok`. Any enabled broker with no read path, or an order-capable broker with no write path, is listed first with "tools changed".

## connect (US2)

Args: `tools` (array, required), `skip` (array of broker names), `unattended` (bool), `hook_plugin` and `hook_version` (strings from the session-start context; a version or edition mismatch is reported).

Returns:

```json
{ "ok": true, "ready": false,
  "brokers": { "kite": { "status": "live|needs_login|tools_changed|not_connected|stale|outage|format_error|skipped", "as_of": "…", "detail": "…" } },
  "next": [ { "do": "call", "tool": "mcp__…__session", "args": { "mode": "status" }, "why": "check whether Kite renews by itself" } ],
  "manual": [ { "broker": "kotak", "steps": ["Open the link from get_login", "In the app: Profile > Web Login > scan"] } ],
  "text": "…" }
```

Sequence per broker: (1) session check if the broker has one; (2) one cheap read; (3) the full reads from `toolmap.readCalls`; (4) a login only when (2) or (3) returned a login error. `manual` lists every human step for all brokers at once. When `ready` is true, `text` is one line per broker plus `All connected · <time>` (or `Connected: kite, ibkr · skipped: kotak (data from <time>)`).

Unattended: never emits login steps; returns `ready: true` with each non-live broker as `skipped` and its reason.

`broker_status` remains as an alias that calls `connect` with the tools seen in captures and returns its `text`.

## review_start (US3)

Args: `kind` (`full | eod | friday`, default `full`), `unattended` (bool), `tools` (array).

Creates `runs/<date>-<kind>.json` or returns the existing one for today (resume). Returns the same shape as `review_next`.

## review_next (US3)

Args: `run` (id, optional; default today's `full`), `corporate_actions` (array, passed to the GTT draft at execute), `record` (`{ todoist: synced | skipped, dashboard: updated | skipped }`, at the record stage once those are done).

Performs the current stage once and returns:

```json
{ "ok": true, "run": "2026-11-13-full", "stage": "research",
  "gate": { "pass": false, "reason": "2 findings missing", "needs": ["ALPHA ebitda_margin_pct Q2 FY27", "BETA gnpa_pct Q2 FY27"] },
  "next": [ { "do": "research", "brief": [ … ], "then": "research_submit" } ],
  "tasks": [ … only at propose and later … ],
  "text": "…" }
```

When the gate passes, the stage advances and the response already describes the following stage's `next`. The model loops: do `next`, call `review_next`, until `stage` is `closed`.

Stage text formats:

- propose: one block per task, numbered, at most five:
  ```
  1. Raise ALPHA stop to cost  · plugin · this week
     Why: your profit-lock arm rule (gain over cost ≥ A%) — gain 0.0% over average cost, stop 0.0% below cost (12-Nov 15:30)
     Options: do it (draft a GTT change) · do nothing
     Effect: none on allocation; locks the position at cost
  ```
  followed by `Also due: N (shown tomorrow)` and `Not set: profit lock, drift bands` when relevant.
- record: writes the journal, log, bundle and dashboard files once, then waits with a `todoist` step and a `dashboard` step until `record` reports both.
- closed: `Run closed · N done, N deferred, N blocked · log, journal, bundle, Todoist, dashboard updated`. When the investor skipped one, it drops from that list and the line ends `· not updated (you said skip): todoist` (or `dashboard`, or both).

## task_decide (US3)

Args: `run`, `task` (id), `decision` (`approved | deferred | declined`), `reason` (text), `defer_until` (date, for deferred), `option` (option id, for approved).

The model calls it after the investor answered the task question in the inline question UI. Rejected when the run is not at `propose` or `execute`. A decision authorises no order.

## task_done (US3)

Args: `run`, `task`, `result` (`done | could_not | skipped`), `note`.

For investor-executed tasks after "done". Sets `outcome: handed_over`; verification still runs.

## research_submit (US3, US5)

Args: `run`, `findings` (array of Finding, see data-model section 6), `corporate_actions` (array of `{ symbol, kind: bonus | split | demerger | dividend, ratio, price_factor, ex_date, confirmed }`; pass `[]` when none found). The research gate stays shut until the corporate-action check is recorded.

Validation: `symbol` held or named in the brief; `metric` from the list below; `value` a number; `period` non-empty; `source_url` http(s); `accessed` a date not after today; for `not_found` and `blocked_source`, `value` must be absent. Returns accepted and rejected findings with reasons.

Metrics (numeric; flags use 1 for yes, 0 for no):

| Metric | Unit |
|---|---|
| `sales_growth_yoy_pct`, `profit_growth_yoy_pct` | % |
| `ebitda_margin_pct`, `opm_pct` | % |
| `gnpa_pct`, `nnpa_pct`, `slippage_pct`, `credit_cost_pct` | % |
| `roa_pct`, `roe_pct`, `nim_pct`, `cost_of_borrowing_pct` | % |
| `debt_to_equity` | ratio |
| `pe` | ratio |
| `flag_guidance_cut`, `flag_regulatory_escalation`, `flag_auditor_qualification`, `flag_results_delayed` | 0 or 1 |

Adding a metric is a code change with a test, not a free-text field.

## review_status (US3)

Args: `run` (optional). Returns the run record summarised in `text` (stage, gate, tasks with decisions and outcomes). Read-only.

## state_export / state_import / state_writeback (US6)

- `state_export` args: `out` (file path, required), `source` (label stored in the bundle, default `pc`). Writes the bundle (data-model section 8). Returns size and file list.
- `state_import` args: `bundle` (file path), `into` (folder). Restores files; refuses if `into` holds newer copies unless `force`.
- `state_writeback` args: `bundle` (the original bundle path, required), `source_hashes` (object: path to sha256 of the computer copy). Returns `next: [{ do: "files", op: "writeback", files: [{ path, content_b64 }] }]` for files changed since the bundle, and `conflicts` for source files whose hash no longer matches. Never writes anything itself.

## profit_lock_dryrun (US4)

Args: `arm_gain_pct`, `book_gain_pct`, `trail_pct` (numbers, required; 0 < arm < book, trail > 0), `scope` (`play | all_stocks`, default `play`).

Returns a table of holdings that would be `armed`, `book`, `trailing` or `idle`, with gain over cost, current stop vs cost, and the stop the rule would propose. Saves nothing.

## decisions (US5)

Args: none beyond `folder`. Runs all rules on the latest snapshot outside a review and returns the tasks as `review_next` would at propose. Saves nothing. For "what is due" questions.

## journal_readback (US5)

Args: `older_than_days` (default from `review.readback_after_days`).

Returns decided tasks older than the threshold with the measurements then and now.

## export (US7, usable without the local engine)

Args: `format` (`dashboard`, the only one), `out` (folder; default `dashboard/` in the state folder). Needs a snapshot; run `refresh` first.

Writes `positions-<date>.json` and `cash-<date>.json` in the shape the investor's dashboard reads (fields: key, broker, sym, name, type, kind, bucket, core, qty, avg, ltp, prevClose, fx, gttQty, gttStop, gttTarget, settling, dma50, dma200, rsi, sup20, hi52, asof). Missing technicals are null, never estimated.

## lots_build (US8)

Args: `tradebook_csv` and/or `mf_statement_csv` (paths; at least one; CSV only, no spreadsheet parsing).

Builds `lots.json` first-in first-out and reports reconciliation per symbol against the latest snapshot, realised short-term and long-term gains for the year, and any problems. Tax on a sell shows only once `tax.*` rates with `as_of` are saved.

## Changes to existing commands

| Command | Change |
|---|---|
| `broker_status` | Alias of `connect` (above) |
| `refresh` | Reads captures by capability; writes `price_as_of`, `day_qty`, `frozen`; updates `marks.json` |
| `gtt_audit` | New findings `gain_unprotected`, `today_buy_counted`; locked names in their own crash-test column |
| `draft_gtt_plan`, `draft_basket`, `draft_orders` | Rows `{ cap, tool, args }` from `toolmap.writeCall`; refuse without a profile; text says that a broker approval step means "not placed yet" |
| `log_append` | Writes to `profile.log.path` when set; fails on any write error |
| `report_gap` | `--flush` files queued gaps; queue when no token |
| `check` | Adds a guardrails table (stock, sector, fund house, closest stop) with bases |
