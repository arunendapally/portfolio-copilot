# Implementation Plan: Guided review, decision rules and a model-light engine

**Branch**: `002-guided-review` | **Date**: 2026-11-12 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/002-guided-review/spec.md`

## Summary

Four releases, each useful alone:

| Release | Stories | What ships |
|---|---|---|
| v0.7.4 (hotfix) | US1 | One broker tool map; gate, capture, status and drafts read from it; unknown broker tools denied; `doctor` |
| v0.8.0 | US2, US3, US6 | `connect`, the review run (`review_*`), task records, state bundle, valuation fixes FR-042 to FR-046 |
| v0.9.0 | US4, US5 | Profit lock, decision rules, journal, Friday read-back |
| v1.0.0 | US7, US8 | Local engine (collectors + stdio MCP server), dashboard export, technicals, tax lots. Needs constitution v2.0.0 |

The existing engine stays. About four fifths of the code is untouched: `drafts.js`, `gtt.js` (audit and plan), `snapshot.js` (consolidate, diff), `profile.js` (extended, not replaced), `approve.js`, the analyst agent. New code is additive modules behind `core/tools.js`.

## Technical Context

**Language/Version**: Node.js 18+ (CommonJS, `'use strict'`), as today

**Primary Dependencies**: none at runtime for the plugin and `pc.js`. The local engine (US7) may use the MCP SDK only (Principle VI allows it) or a hand-written stdio JSON-RPC loop; decide in T084 after reading the v0.5 server in git history (tag `v0.5.0`).

**Storage**: JSON files. Investor folder: `portfolio-copilot/{profile.json, snapshots/, drafts/, runs/, journal.jsonl, marks.json, lots.json, log.md}`. Per-machine: `~/.portfolio-copilot/{captured/, sessions.json, gaps-pending.json}`

**Testing**: `node --test tests/*.test.js` on made-up fixtures; `python evals/run-evals.py` (T0 to T4 exist; T2 is extended and T5, the guided review, is added); `claude plugin validate --strict`

**Target Platform**: Windows, macOS, Linux; Claude Code CLI, Cowork desktop and cloud chat. The local engine targets the investor's own computer.

**Project Type**: Claude plugin (hooks + skills + bundled CLI engine), plus an optional local service built from the same engine

**Performance Goals**: `review_next` under 300 ms per call on a 50-holding book; full review within 30K tokens chat-only (SC-004) and 8K with the local engine (SC-005)

**Constraints**: constitution v1.0.0; no personal data in the repo; six skills, each under sixty lines; fail closed on any gate error; no private broker endpoints

**Scale/Scope**: one investor per folder, up to about 100 holdings and 100 standing orders, 30 snapshots kept

## Constitution Check

| Principle | US1-US6 | US7-US8 | Note |
|---|---|---|---|
| I. Plugin drafts, user executes | Pass. Strengthened: the gate matches by broker, not by tool-name suffix, and denies unknown tools | Pass. The local engine is read-only (FR-048) | Task approval never authorises an order (FR-020) |
| II. Numbers come from code | Pass. Research enters as validated findings; rules evaluate in code | Pass | The model never computes a threshold crossing |
| III. Analysis, not advice | Pass. Tasks come from the investor's saved rules; no default thresholds for profit lock (FR-026) | Pass | Cards always include "do nothing" |
| IV. One connection per broker | Pass | Pass under constitution 2.0.0 (amended 18-Nov-2026) | A read-only local collector per broker is allowed with the conditions in Principle IV; see research R6 |
| V. State is data | Pass. New state files are JSON, schema-versioned | Pass | The bundle makes cloud use honest |
| VI. Simple and fast by budget | Pass. No new skill; `check` becomes the review entry; skills shrink | Pass | Budgets restated as SC-004 and SC-005 |
| VII. Release only when tests pass | Pass. New tests and eval T5 | Pass | T2 extended to every tool name in the map |

Gate result: US1 to US6 may proceed. US7 may not start until the constitution amendment in T082 is merged.

## Architecture

### 1. Broker tool map (US1): `core/lib/brokers/toolmap.js`

The single place a broker tool name may appear (FR-002). Shape in [contracts/broker-tools.md](contracts/broker-tools.md).

```js
// one entry per (broker, tool, mode)
{ broker: 'kite', tool: 'gtt', mode: 'place', kind: 'write', cap: 'gtt_write', since: '2026-11' }
{ broker: 'kite', tool: 'get_gtts',           kind: 'read',  cap: 'gtts',      until: '2026-11' }
```

API: `resolve(toolName, toolInput) -> { broker, kind: 'read'|'write'|'session'|'unknown', cap, mode }`, `writeCall(broker, cap, args, present) -> { tool, args }`, `readCalls(broker, present) -> [{ tool, args, cap }]`, `doctor(presentToolNames, profile) -> per-broker report`. `present` is the list of tool names in the chat; when unknown, the newest generation is assumed.

Broker is found from the tool's server segment (`kite`, `kotak`, `interactive_brokers|ibkr`), exactly as `session.sourceOf` does today. Tool is the segment after the last `__`.

### 2. Hooks (US1)

- `hooks/hooks.json`: PreToolUse matcher becomes "any tool of a known broker, or AskUserQuestion". PostToolUse and PostToolUseFailure use the same broker matcher. The scripts decide what to do; the matcher no longer encodes verbs.
- `hooks/order-gate.js`: `resolve()` first. `read` and `session` pass. `write` goes through today's draft-row matching, with `mode` part of the compared arguments and a small ignore list (`last_price`, `tag`, `_app_request_id`, `approval_method`). `unknown` on an order-capable broker (kite, ibkr) is denied; on a read-only broker (kotak) it passes and is logged.
- `hooks/capture.js`: saves only `read` results, as `<cap>.json` (not `<tool>.json`), so both tool generations land in the same file. Price reads merge as today.
- Draft rows store `{ cap, tool, args }`. The gate compares `tool` and `args`; `cap` is for display.

### 3. Status and connect (US1, US2): `core/lib/inputs.js`, new `core/lib/connect.js`

- `NEEDED`/`OPTIONAL` are lists of capabilities, not tool names.
- Partial reads: `pagination.has_more === true`, or `from > 0`, or `returned < total` (FR-007). A plain call with the default page size is complete when `has_more` is false.
- `connect` returns `{ brokers: { name: { status, as_of, next: [{ tool, args, why }] } }, manual: [ ... ], ready: bool, text }`. The skill makes the `next` calls, collects every `manual` item into one message, calls `connect` again, and prints `text`. Order per broker: session check, one cheap read, full reads, then login only if a read says so.
- Kotak cash: parse the limits payload with `parseDelimited` and header aliases (`cash margin`, `available margin`, `net`). Unparsed is `unknown` and blocks live (FR-046).

### 4. Review run (US3): `core/lib/review.js`, `core/lib/tasks.js`

State machine persisted in `runs/<date>-<kind>.json` ([data-model.md](data-model.md)). Commands ([contracts/pc-commands.md](contracts/pc-commands.md)): `review_start`, `review_next`, `review_status`, `research_submit`, `task_decide`, `task_done`.

`review_next` does one stage step and returns `{ stage, gate: { pass, reason, needs }, next: [...], text }`. It never skips a stage; a failed gate returns what is needed and leaves the stage unchanged.

| Stage | Engine does | Gate |
|---|---|---|
| connect | `connect` | every enabled broker live, or explicitly skipped by the investor |
| pull | `refresh` (and `ingest` for IBKR with a dated FX rate) | snapshot written today; skipped brokers labelled |
| research | emits a brief: symbols with an event, the metrics each tripwire needs, corporate-action check | every requested finding submitted with source and date, or marked "not found" |
| evaluate | runs rules (section 5) | always passes; may yield zero tasks |
| propose | returns up to five tasks | each task has a decision |
| execute | per approved task: draft, or manual steps | each approved task is `executed`, `handed_over` or `blocked` |
| verify | compares a fresh read with each task's expected effect | no task is `executed` and unconfirmed |
| record | log entry, journal, bundle export; returns the Todoist sync list | all writes succeeded |

Run kinds: `full`, `eod` (connect, pull, evaluate, record; tasks are listed, not executed), `friday` (full plus `journal_readback` before propose). Unattended (`--unattended`) stops after research.

The engine cannot browse or call Todoist. For those it returns instructions (`next`) and validates what comes back (`research_submit`, `task_done`). This keeps Principle II: the model carries data, the engine judges it.

### 5. Rules (US4, US5): `core/lib/rules/*.js`, `core/lib/decisions.js`

One file per evaluator, each `evaluate({ snap, prev, profile, marks, findings, lots, now }) -> Task[]`: `gtt_gaps.js` (wraps `gtt.audit`), `profit_lock.js`, `concentration.js`, `drift.js`, `tripwires.js`, `contributions.js`, `reentry.js`, `tax_budget.js` (US8). `decisions.js` runs them, de-duplicates by task id, orders by fixed priority (safety, profit lock, tripwire, concentration, drift, contributions, tax), caps at five.

Task id is `sha1(kind|symbol|rule_ref|bucketed measurement)` so the same situation keeps its id across days and a deferred task is not re-proposed until its `defer_until`.

Profit lock ([data-model.md](data-model.md), Mark): stages `idle -> armed -> booked -> trailing`. Stop targets: armed = average cost rounded to tick; trailing = `high_close * (1 - trail_pct/100)`, never below the current stop. `gtt.audit` gains finding `gain_unprotected`; `gtt.plan` treats a locked holding's stop target as given and skips the minimum-distance rule for it. The crash test reports locked names in their own column.

### 6. State bundle (US6): `core/lib/bundle.js`

`state_export` writes one JSON with profile, the last two snapshots, open drafts, today's runs, marks, journal tail, log tail, and a manifest of file hashes at export time. `state_import` restores it into a folder. `state_writeback` returns the list of changed files with content, and refuses when a source hash in the manifest no longer matches (FR-038, US6 scenario 5). The skill moves files through the device link; the engine never assumes where it runs.

`state.writeJson` already throws on failure; `log.js` and `gap.js` are audited to do the same (FR-039). `callTool` returns `ok: false` without a profile for `draft_*`, `task_done` and `review_next` at execute (FR-040).

### 7. Local engine (US7): `local/`

```text
local/
├── server.js          # stdio MCP server: status, review, query, run
├── collect.js         # scheduler: one pull per day per broker, on demand
├── collectors/        # kite.js, kotak.js, ibkr.js behind one interface
├── export.js          # dashboard files
└── technicals.js      # averages and RSI from daily closes
```

Collectors write the same `captured/<broker>/<cap>.json` files the hook writes, so everything downstream is unchanged. The server calls `callTool` from `core/tools.js`. How each collector reaches its broker is research R6 and an investor decision. The server exposes no order capability; `draft_*` still works and execution stays in chat or with the investor.

In a cloud chat the local server is reached through the desktop link like any local MCP server. When present, the `check` skill uses it and makes no broker read in chat.

### 8. Skills and build

`skills/check/SKILL.md` becomes the review entry: say "review", call `review_start`, loop on `review_next` doing what `next` says. Target: under 45 lines. Other skills lose their tool-name prose and describe capabilities; `pc doctor` and the drafts give the exact calls (FR-055). Six skills stay six.

## Project Structure

### Documentation (this feature)

```text
specs/002-guided-review/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── broker-tools.md
│   ├── hooks.md
│   ├── pc-commands.md
│   └── local-engine.md
├── checklists/requirements.md
└── tasks.md
```

### Source Code (repository root)

```text
core/
├── tools.js                    # + connect, doctor, review_*, research_submit, task_*, state_*, profit_lock_dryrun, export
├── lib/
│   ├── brokers/toolmap.js      # NEW (US1)
│   ├── brokers/normalize.js    # kotak cash, positions, frozen valuation
│   ├── inputs.js               # capabilities instead of tool names
│   ├── session.js              # files named by capability
│   ├── connect.js              # NEW (US2)
│   ├── review.js               # NEW (US3)
│   ├── tasks.js                # NEW (US3)
│   ├── manual_steps.js         # NEW (US3) templates per task kind
│   ├── decisions.js            # NEW (US5)
│   ├── rules/*.js              # NEW (US4, US5, US8)
│   ├── marks.js                # NEW (US4)
│   ├── journal.js              # NEW (US5)
│   ├── bundle.js               # NEW (US6)
│   ├── lots.js                 # NEW (US8)
│   └── gtt.js, snapshot.js, profile.js, gap.js, log.js   # extended
hooks/
├── hooks.json                  # broker-level matchers
├── order-gate.js, capture.js   # use toolmap
local/                          # NEW (US7), excluded from the lite edition
skills/check/SKILL.md           # rewritten around review_*
tests/
├── toolmap.test.js, gate-toolmap.test.js, capture-toolmap.test.js
├── connect.test.js, review.test.js, tasks.test.js, bundle.test.js
├── profit-lock.test.js, decisions.test.js, journal.test.js
├── valuation.test.js, lots.test.js, local-engine.test.js
└── fixtures/                   # made-up tool lists and payloads for both Kite generations
evals/run-evals.py              # T2 extended, T5 added
```

**Structure Decision**: stay a single-project plugin. New behaviour is new modules under `core/lib/` registered in `core/tools.js`; the optional local engine is a sibling folder that imports the same core. No module is split or renamed.

## Complexity Tracking

| Violation | Why needed | Simpler alternative rejected because |
|---|---|---|
| Principle IV: a local collector is a second route to a broker (US7 only) | The token cost is in payloads passing through the model; only pulling outside the model removes it, and it makes unattended runs useful | Chat-only pulls meet the 30K budget but cannot go below it, and cannot run unattended. The v0.6 problem (a second session that expires and fights the first) is addressed by one deliberate daily login in the collector and by making the collector the only reader when it is running |
| Run state machine with eight stages | The investor asked for gates and a start-to-end flow; resumability needs persisted state | A skill-only checklist is what exists today and is skipped under pressure |
| Rules as separate evaluators | Each maps to one investor decision and one test file | One large function would be untestable per rule |

## Risks

1. **Gate too strict after US1**: denying unknown tools may block a harmless new read. Mitigation: the deny reason says how to proceed, `doctor` lists it at session start, and a rename is a one-file fix (SC-012).
2. **Profit lock whipsaw**: a tight trail sells sound names. Mitigation: no default values, the dry run, and a backtest task before the investor adopts numbers (T067).
3. **Research quality**: wrong figures would trigger exits. Mitigation: findings need source and date, the analyst agent's output check stays, and a tripwire card shows the finding verbatim.
4. **Hook environment**: hooks run where the chat harness runs, which may not be where the investor's folder is. Mitigation: drafts live in the working copy the hooks can read (unchanged since v0.7), and the bundle moves them.
5. **Broker terms for direct access** (US7): unverified. Mitigation: R6 must be completed and signed off before any collector is written.
