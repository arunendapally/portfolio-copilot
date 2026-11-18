# Tasks: Guided review, decision rules and a model-light engine

**Input**: Design documents from `/specs/002-guided-review/`

**Prerequisites**: [spec.md](spec.md), [plan.md](plan.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/](contracts/)

**Tests**: required (constitution Principle VII). In every phase, write the tests first and see them fail.

## Brief for the implementing session

You are implementing a design whose product owner and architect has already decided the what and the how. Your job is to build it to the contracts, not to redesign it.

1. **Read in this order**: `.specify/memory/constitution.md`, `spec.md`, `plan.md`, `data-model.md`, `contracts/*.md`, `research.md`, then this file. Then read the existing modules a task names before editing them.
2. **Owner decisions, not yours**: profit-lock values (T067), the loss-tolerance measure (T079), the local-engine broker route and the constitution amendment (T081, T082), every `git push`, every release upload. Stop and ask the investor. Do not pick defaults to unblock yourself.
3. **Live broker steps** (T004, T005, T081) need the investor present. Never place, change or delete a real order or GTT in a test or an eval.
4. **No personal data in the repo**: fixtures use made-up symbols (`ALPHA`, `BETA`, `GAMMAETF`) and made-up numbers. Never copy a payload from a real session, a snapshot, a profile or a log. No names of people or employers.
5. **Surgical changes**: edit only what a task names. Do not refactor modules the plan marks as unchanged (`drafts.js`, `approve.js`, the analyst agent).
6. **One release per checkpoint**: one PR per release, tests green (`npm test`), `claude plugin validate --strict`, `node scripts/build.js --check`, the listed evals. Bump the version in the same PR.
7. **When the spec is wrong**: if a contract cannot be met as written, stop, write the problem and a proposed change at the end of `research.md` under "Open from implementation", and ask. Do not silently deviate.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: US1 to US8 from spec.md
- **[Investor]**: needs the investor; cannot be completed by the implementing session alone

## Path Conventions

Single project at the repository root: `core/`, `hooks/`, `skills/`, `tests/`, `evals/`, `scripts/`, and a new `local/` (US7 only).

---

## Phase 1: Setup

- [x] T001 Create branch `002-guided-review` from `main`, commit this spec folder unchanged, and set `.specify/feature.json` `feature_directory` to `specs/002-guided-review`
- [x] T002 [P] Add made-up fixtures: `tests/fixtures/toolnames.json` (every tool in contracts/broker-tools.md under the prefixes `mcp__kite__`, `mcp__remote-devices__kite__`, `mcp__claude_ai_Kite__` and the Kotak and IBKR equivalents); `tests/fixtures/kite-gen2/` with `holdings-full.json`, `holdings-compact.json`, `gtts.json`, `gtts-page1.json` (`has_more: true`), `margins.json`, `mf.json` (bare array), `positions.json` (day and net rows), `session-expired-refreshable.json`, `session-ok.json`, `orders-approval-required.json`; `tests/fixtures/kotak-limits.txt` (the CSV header in research R3, made-up values)
- [x] T003 [P] Extend `tests/helpers.js`: `runHook(script, input)` that pipes JSON to a hook script and parses its stdout; `fakeBrokers` able to seed generation-2 captures by capability
- [ ] T004 [Investor] With the investor present, place one throwaway GTT far from the price through the Kite connector's `gtt` mode `place`, then try mode `modify` and mode `delete`. Record the exact responses in research.md R1. If delete works, note it for T025
- [ ] T005 [Investor] With the investor present, after a day when the Kite session has fully lapsed, record what `session` mode `status` returns and what starts a login when `refresh_available` is false. Record in research.md R1

---

## Phase 2: Foundational (blocks US2 to US8; US1 does not depend on it)

- [x] T006 [P] Write `tests/profile-v2.test.js`: a v1 profile loads with v2 defaults; every validation rule in data-model section 1 rejects a bad value with a precise message; `profit_lock.enabled: true` with any null value is rejected; an unknown tripwire metric is rejected
- [x] T007 Implement profile schema v2 in `core/lib/profile.js`: defaults (all new thresholds null), migration on load, validation per data-model section 1. Keep every v1 field and default unchanged

**Checkpoint**: `npm test` green; no behaviour change for an existing profile.

---

## Phase 3: User Story 1 - Safe and working again after a broker renames its tools (P1) 🎯 Hotfix v0.7.4

**Goal**: the order gate covers every broker write under both Kite tool generations; reads are captured by capability; status says "tools changed" instead of "outage".

**Independent Test**: spec.md US1.

### Tests for US1

- [x] T008 [P] [US1] `tests/toolmap.test.js`: every row of contracts/broker-tools.md resolves to its kind and capability under at least two prefixes; `gtt`/`orders`/`portfolio` with no mode or an unlisted mode resolve to `unknown`; made-up tools resolve to `unknown` with `order_capable` true for Kite and IBKR and false for Kotak; `writeCall` returns generation-2 calls when generation-2 tools are present and generation-1 calls otherwise
- [x] T009 [P] [US1] `tests/gate-toolmap.test.js`: with no draft, every write row in `toolnames.json` is denied; with an approved draft row, the matching call passes once and the repeat is denied; `mode` is compared; `last_price`, `tag`, `_app_request_id`, `approval_method` are ignored; unknown Kite and IBKR tools are denied with the reason in contracts/hooks.md; unknown Kotak tools pass and append to `gaps-pending.json`; a thrown error denies
- [x] T010 [P] [US1] `tests/capture-toolmap.test.js`: generation-1 and generation-2 reads land in the same `<cap>.json`; compact holdings are not captured as holdings; `has_more: true`, `from > 0` and `returned < total` mark a read partial; an `unknown tool` failure sets `tools_changed`; `ltp` reads merge
- [x] T011 [P] [US1] `tests/hooks-matchers.test.js`: load `hooks/hooks.json`; every name in `toolnames.json` matches the PreToolUse, PostToolUse and PostToolUseFailure broker matchers; non-broker tools do not
- [x] T012 [P] [US1] `tests/no-tool-names.test.js`: no tool name from contracts/broker-tools.md appears in `core/`, `hooks/` or `skills/` source except `core/lib/brokers/toolmap.js`; only names containing an underscore are checked, since one-word tools are ordinary words in prose

### Implementation for US1

- [x] T013 [US1] Create `core/lib/brokers/toolmap.js` exactly per contracts/broker-tools.md (`resolve`, `readCalls`, `writeCall`, `doctor`), with both Kite generations, Kotak Neo and IBKR
- [x] T014 [US1] Replace the broker matchers in `hooks/hooks.json` with the broker-level matcher in contracts/hooks.md
- [x] T015 [US1] Rewrite the decision in `hooks/order-gate.js` around `toolmap.resolve` per contracts/hooks.md; keep `sameArgs`, row claiming and the AskUserQuestion pre-fill check as they are
- [x] T016 [US1] Change `core/lib/session.js` to name capture files by capability, store `mode`, `partial` and `tools_changed`, and keep the `ltp` merge
- [x] T017 [US1] Change `hooks/capture.js` to call `toolmap.resolve` and capture only `read` results with a capturable capability (contracts/hooks.md)
- [x] T018 [US1] Change `core/lib/inputs.js`: `NEEDED`/`OPTIONAL` as capabilities (`holdings`, `gtts`, `margins`; optional `mf`, `orders`, `positions`); status `tools_changed`; partial from the capture record; hints built from `toolmap.readCalls`; unwrap `{ data, pagination }` and bare arrays
- [x] T019 [US1] Parse Kotak limits in `core/lib/brokers/normalize.js` with `parseDelimited` (`cash margin`, then `available margin`); in `inputs.pull`, unparsed cash sets `cash_status: unknown` and status `format_error` (FR-046)
- [x] T020 [US1] In `core/tools.js`, build draft rows `{ cap, tool, args }` through `toolmap.writeCall` in `draftGttPlan`, `draftBasket` and `draftOrders` (replace `ORDER_TOOLS` with capabilities); the plan text tells the model that a broker approval step means "not placed yet" and to confirm with an orders or GTT read (FR-010)
- [x] T021 [US1] Add the `doctor` command to `core/tools.js` (contracts/pc-commands.md); add the doctor line to `hooks/session-start.js`
- [x] T022 [US1] Queue unfiled gaps in `~/.portfolio-copilot/gaps-pending.json` in `core/lib/gap.js`; add `report_gap --flush` (FR-057)
- [x] T023 [US1] Rewrite `skills/check`, `skills/gtt`, `skills/risk`, `skills/crash` in capability language with no broker tool names; exact calls come from `pc doctor` and draft output (simplified 14-Nov from build-time markers); keep each skill under sixty lines
- [x] T024 [US1] Extend eval T2 in `evals/run-evals.py`: run it against a fake broker MCP exposing generation-2 Kite tools, and add a prompt that asks for a made-up Kite tool; both must be denied
- [ ] T025 [US1] Release v0.7.4: version in `.claude-plugin/plugin.json` and `package.json`, `CHANGELOG.md`, README "Brokers" (tools matched by capability; drop the Kite-web delete fallback only if T004 showed delete works), `node scripts/build.js`, `claude plugin validate --strict`, `npm test`, evals T0 to T2 on full and T0 on lite. Open the PR; push and upload only on the investor's go

**Checkpoint**: SC-001, SC-002 and SC-012 pass. Ship before anything else in this file.

---

## Phase 4: User Story 2 - Connect first, then work (P1)

**Goal**: one engine call drives connection for all brokers, asks once for every manual step and prints "All connected" before any work.

**Independent Test**: spec.md US2.

- [x] T026 [P] [US2] `tests/connect.test.js`: call order per broker (session, cheap read, full reads, login only after a login error); one `manual` list across brokers; `ready` text with one line per broker; `skip` carries data with its age; unattended never emits login steps; a refreshable expired Kite session yields a read, not a login
- [x] T027 [US2] Create `core/lib/connect.js` per contracts/pc-commands.md (connect)
- [x] T028 [US2] Add `connect` to `core/tools.js` (args `tools`, `skip`, `unattended`); make `broker_status` an alias
- [ ] T029 [US2] Kite session handling in `connect.js` from research R1 and the T005 record
- [x] T030 [US2] Kotak in `connect.js`: emit `get_login` with the UCC from the profile and the QR steps as one `manual` item; the engine never stores the session id
- [x] T031 [US2] IBKR in `connect.js`: the reads, then `ingest` with a dated FX rate and its source; without a dated rate IBKR is excluded from totals with a note (spec edge case)
- [x] T032 [US2] Replace step 1 of `skills/check/SKILL.md` with the connect loop (call `connect` with the tool names in the chat, do `next`, ask once for `manual`, repeat until `ready`, print `text`)

**Checkpoint**: SC-003 passes on fixtures.

---

## Phase 5: User Story 6 - One state wherever I chat (P1)

**Goal**: cloud and computer never silently drift; failed writes fail.

**Independent Test**: spec.md US6.

- [x] T033 [P] [US6] `tests/bundle.test.js`: export and import round-trip; bundle under 150 KB on a 100-holding fixture; `state_writeback` lists only changed files; a changed source hash is reported as a conflict and nothing is returned for that file
- [x] T034 [P] [US6] `tests/write-failures.test.js`: `log_append`, `report_gap` and `profile_update` return `ok: false` on a read-only target; drafting commands return `ok: false` without a profile
- [x] T035 [US6] Create `core/lib/bundle.js` (data-model section 8)
- [x] T036 [US6] Add `state_export`, `state_import`, `state_writeback` to `core/tools.js` (contracts/pc-commands.md)
- [x] T037 [US6] Make `core/lib/log.js` and `core/lib/gap.js` throw on write failure; honour `profile.log.path` (FR-039, FR-041)
- [x] T038 [US6] In `callTool`, refuse `draft_gtt_plan`, `draft_basket`, `draft_orders`, `task_done` and execute-stage `review_next` without a real profile (FR-040)
- [x] T039 [US6] Replace the "Profile when the chat is linked to the PC" section of `skills/check/SKILL.md` with: load the bundle through the device link, run, write back with `state_writeback`, report conflicts

**Checkpoint**: SC-009 and SC-010 pass on fixtures.

---

## Phase 6: User Story 3 - A guided daily review from start to end (P1)

**Goal**: "review" runs connect, pull, research, evaluate, propose, execute, verify, record, with gates in code.

**Independent Test**: spec.md US3 (a standing-order quantity gap and an index fund with a stop; both come from the existing GTT audit).

### Tests for US3

- [x] T040 [P] [US3] `tests/review.test.js`: stages run in order; a failed gate stops with `reason` and `needs`; resume on the same day; a second `review_start` returns the same run; `eod` and `friday` stage lists; unattended stops after research; the profile hash is frozen for the run
- [x] T041 [P] [US3] `tests/tasks.test.js`: task ids are stable for the same situation across days; executor decided in code; cap of five with `also_due`; a deferred task is not proposed again before `defer_until`; a task with `needs_fresh` naming a non-live broker is shown but not executable
- [x] T042 [P] [US3] `tests/research.test.js`: finding validation per contracts/pc-commands.md; `not_found` satisfies the gate and never triggers; accepted findings are appended to `findings.jsonl`
- [x] T043 [P] [US3] `tests/valuation.test.js`: a holding frozen at cost for two runs is valued at zero and listed separately; `valuation_overrides` wins; `price_as_of` on every holding; the fresher price is used for an instrument held at two brokers; a fund at two brokers is one position; same-day buys from positions count toward GTT coverage and are labelled "today"
- [x] T044 [P] [US3] `tests/verify.test.js`: each `expect` kind is checked against a fresh snapshot; an unconfirmed executed task blocks `closed`; a manual task is verified the same way

### Implementation for US3

- [x] T045 [US3] In `core/lib/brokers/normalize.js` and `core/lib/snapshot.js`: `price_as_of`, `price_source`, frozen valuation and `valuation_overrides` (FR-042, FR-043)
- [x] T046 [US3] Capture `positions`, compute `day_qty`, and count it in `gtt.audit` coverage with finding `today_buy_counted` (FR-044)
- [x] T047 [US3] In `snapshot.consolidate`: use the fresher price across brokers and merge funds by ISIN or normalised name (FR-043, FR-045)
- [x] T048 [US3] Create `core/lib/tasks.js` (data-model section 5): construction, id hashing, priority order, cap, `needs_fresh`
- [x] T049 [US3] Create `core/lib/decisions.js` and `core/lib/rules/gtt_gaps.js` turning `gtt.audit` findings (`no_gtt`, `qty_short`, `double_coverage`, `stop_too_tight`, `etf_stop`, `exit_stop`, `exit_missing`, `near_stop`, `corp_action`) into tasks with reasons and options
- [x] T050 [US3] Create `core/lib/manual_steps.js`: numbered step templates per task kind (GTT change in the broker's web app, basket entry, bank transfer, QR login), with placeholders filled from the task
- [x] T051 [US3] Create `core/lib/review.js`: the run file (data-model section 4), stage machine and gates per plan section 4
- [x] T052 [US3] Research stage in `review.js`: build the brief (held symbols with `next_results` within 14 days, symbols with tripwires, corporate-action check for all held stocks); validate with `research_submit`; append to `findings.jsonl`
- [x] T053 [US3] Execute stage: plugin tasks call the matching `draft_*` for that symbol only and record `draft_code`; investor tasks return `manual` steps; blocked tasks queue a gap
- [x] T054 [US3] Verify stage: request a fresh pull of the capabilities the tasks touch, then check each `expect`
- [x] T055 [US3] Record stage: `log_append`, journal lines for decided tasks, `state_export`, and Todoist ops (`create`, `update`, `complete`, external id `pc:<task id>`)
- [x] T056 [US3] Add `review_start`, `review_next`, `review_status`, `task_decide`, `task_done`, `research_submit` to `core/tools.js` (contracts/pc-commands.md)
- [x] T057 [US3] In `hooks/order-gate.js`, also deny an AskUserQuestion whose header is a task id (`t_…`) when its answers are pre-filled; test in `tests/gate-toolmap.test.js`
- [x] T058 [US3] Rewrite `skills/check/SKILL.md` around the review loop (say "review", call `review_start`, do each `next`, call `review_next` until closed; task questions use "Approve", "Defer", "Decline", never "Yes, place"); cover end of day, Friday and unattended in one short section; under 45 lines
- [x] T059 [US3] Add eval T5 (guided review) to `evals/run-evals.py` on the fake broker: two tasks proposed with reasons, one approved and drafted, the Yes click simulated, one deferred, run closed; assert no order call happened outside the approved row
- [x] T060 [US3] Release v0.8.0 (US2, US3, US6): version, CHANGELOG, README "What you can say" (review, end of day, Friday), build, validate, tests, evals T0 to T2 and T5. Push and upload on the investor's go

**Checkpoint**: SC-004, SC-006, SC-007 measured on the fixture run and recorded in the PR.

---

## Phase 7: User Story 4 - Keep the gains (P2)

**Goal**: profit lock arms, books and trails per the investor's own thresholds; stops only move up.

**Independent Test**: spec.md US4.

- [x] T061 [P] [US4] `tests/profit-lock.test.js`: no effect while disabled; arm, book and trail transitions; stops never lowered; funds never in scope; scope `play` vs `all_stocks`; `gain_unprotected` finding; locked names exempt from the minimum distance and shown in their own crash-test column; dry run saves nothing
- [x] T062 [P] [US4] `tests/marks.test.js`: `high_close` only rises; reset on full exit; a confirmed corporate action re-bases `high_close` and `last_stop`
- [x] T063 [US4] Create `core/lib/marks.js` (data-model section 3); update marks at the end of the pull stage and in `refresh`
- [x] T064 [US4] Create `core/lib/rules/profit_lock.js`; in `core/lib/gtt.js` add the `gain_unprotected` finding, use the lock's stop target in `plan`, exempt locked names from `min_stop_distance_pct`, and add the crash-test column (FR-027 to FR-030)
- [x] T065 [US4] Apply `classes` (FR-032): default funds core, stocks play; per-symbol override from the profile
- [x] T066 [US4] Add `profit_lock_dryrun` to `core/tools.js` (contracts/pc-commands.md)
- [ ] T067 [Investor] [US4] Choose the profit-lock values. Provided: `core/bin/backtest-profit-lock.js` (in core so it ships with the plugin; the spec said scripts/) that reads a tradebook CSV path and daily closes from an argument and prints, per candidate value set, how many trades would have been stopped, booked or kept and the result; it writes nothing to the repo. The investor runs it on their own data, reviews it with the dry run, and saves the values with `profile_update`. Do not commit any output
- [x] T068 [US4] Create `core/lib/rules/reentry.js`: a sale by a trailing stop adds the symbol to `reentry` with its cool-off; `core/lib/audit.js` flags a buy inside the cool-off
- [x] T069 [US4] Add policy rule 8 (profit lock) to `skills/gtt/SKILL.md` and the README "Default GTT policy" section, stating that it is off until the investor sets every value

---

## Phase 8: User Story 5 - Decisions due, from my own rules (P2)

**Goal**: the investor's rules for limits, drift, tripwires and contributions produce at most five cards, journaled and read back on Fridays.

**Independent Test**: spec.md US5.

- [x] T070 [P] [US5] `tests/decisions.test.js`: each rule fires on its fixture and stays silent below threshold; bases named; a rule with a null threshold is reported "not set"; deterministic output for the same inputs; priority order and the cap of five
- [x] T071 [P] [US5] `tests/journal.test.js`: decided tasks are appended with measurements; Friday read-back pairs old decisions with current measurements
- [x] T072 [US5] Create `core/lib/rules/concentration.js` (single stock, sector with `sector_base` and sector funds, fund house); add the guardrails table to `check` text
- [x] T073 [US5] Create `core/lib/rules/drift.js`: bands per bucket from `allocation.bands_pp`; option "close with new money" shows the amount
- [x] T074 [US5] Create `core/lib/rules/tripwires.js`: reads `findings.jsonl`, honours `for_quarters` and `on_tripwire`, shows the finding and its source on the card
- [x] T075 [US5] Create `core/lib/rules/contributions.js`: plan path from `profile.plan` (monthly amounts, step-up, return), card when the book is behind by more than `behind_tolerance_pct`
- [x] T076 [US5] Create `core/lib/journal.js`, the `journal_readback` command and the Friday stage step
- [x] T077 [US5] Add the `decisions` command to `core/tools.js`
- [x] T078 [US5] Update `skills/get-started/SKILL.md`: collect bands, sector map (including sector funds), classes, tripwires and the plan; "import my notes" shows a diff of what differs from the profile and saves each item only on confirmation
- [x] T079 [US5] Loss-tolerance tracker card (decision 2 answered 17-Nov: realised plus open): `core/lib/rules/loss_tolerance.js` with tests. Open losses only until lots (US8) give realised losses; the card says so
- [ ] T080 [US4] [US5] Release v0.9.0: version, CHANGELOG, README, build, validate, tests, evals T0 to T2 and T5. Push and upload on the investor's go

---

## Phase 9: User Story 7 - The model only when it adds something (P3)

**Goal**: a local read-only engine pulls, computes and serves summaries; the chat sees no raw payloads.

**Independent Test**: spec.md US7.

- [x] T081 [Investor] [US7] Complete research R6 from first-party broker pages (terms, limits, cost, login flow), record each with its date, and get the investor's choice per broker
- [x] T082 [Investor] [US7] Constitution amendment v2.0.0: redefine Principle IV to allow one read-only local collector per broker alongside the chat connector, with the conditions in plan Complexity Tracking. Update the Sync Impact Report and dependent templates. Blocks T085 to T095 except T083
- [x] T083 [P] [US7] Add `export --format dashboard` to `core/tools.js` (contracts/pc-commands.md) with `tests/export.test.js`. Needs only T045; may be done before the rest of US7
- [x] T084 [US7] Decide MCP SDK or a hand-written stdio JSON-RPC loop for `local/server.js` after reading the v0.5.0 server in git history; record the decision and reason in research.md
- [x] T085 [P] [US7] `tests/local-engine.test.js` per contracts/local-engine.md
- [x] T086 [US7] Create `local/collectors/index.js` (interface) and a fake collector used by the tests
- [x] T087 [US7] Create `local/collectors/kite.js` per the T081 choice
- [x] T088 [US7] Create `local/collectors/kotak.js` per the T081 choice (or document that Kotak stays in chat)
- [x] T089 [US7] Create `local/collectors/ibkr.js` per the T081 choice
- [x] T090 [US7] Create `local/collect.js` (on demand and `--daily HH:MM`, one retry per hour, login needs recorded)
- [x] T091 [US7] Create `local/technicals.js` and the `history` capability; write `snapshot.technicals` with dates (FR-052)
- [x] T092 [US7] Create `local/server.js` with the four tools and the `next` filtering in contracts/local-engine.md
- [x] T093 [US7] `skills/check/SKILL.md`: call `portfolio_status` first; use the local tools when it answers, fall back to v0.8 behaviour on any error
- [x] T094 [US7] `scripts/build.js` excludes `local/` from the lite edition; README section "Local engine (optional)" with setup steps
- [ ] T095 [US7] Release v1.0.0 candidate: SC-005 measured with the local engine and recorded in the PR

---

## Phase 10: User Story 8 - Tax in view on every sell (P3)

- [x] T096 [P] [US8] `tests/lots.test.js`: FIFO lots from made-up CSVs; reconciliation mismatch reported; short and long term per lot; remaining exemption; cards without lots say "tax not computed"
- [x] T097 [US8] Create `core/lib/lots.js` and the `lots_build` command (CSV only; no spreadsheet parsing)
- [x] T098 [US8] Create `core/lib/rules/tax_budget.js`; add lot, holding period, realised gains and remaining exemption to sell and switch options; every such card says "confirm with your tax adviser"
- [ ] T099 [US8] Include in the v1.0.0 release, or v1.1.0 if US7 shipped first

---

## Phase 11: Polish & Cross-Cutting

- [x] T100 [P] Add a v0.8 to v1.0 addendum to `docs/specs/architecture-review.md` (tool map, run state machine, local engine)
- [ ] T101 Re-run the Constitution Check table in plan.md at each release and record pass or justified exception
- [ ] T102 Run [quickstart.md](quickstart.md) end to end on fixtures before each release
- [ ] T103 Measure and record SC-004 and SC-005 token use on the fixture review with and without the local engine

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: none. T004 and T005 need the investor and can run any time before T025 and T029.
- **Foundational (Phase 2)**: after Setup; blocks Phases 4 to 10. Phase 3 (US1) does not need it.
- **US1 (Phase 3)**: after Setup. Ship first.
- **US2 (Phase 4)** and **US6 (Phase 5)**: after US1 and Foundational; independent of each other.
- **US3 (Phase 6)**: after US2 and US6.
- **US4 (Phase 7)**: after US3 (tasks and the review run). T067 can start as soon as T066 exists.
- **US5 (Phase 8)**: after US3; independent of US4 except the shared release T080.
- **US7 (Phase 9)**: after T081 and T082 (owner decisions); T083 needs only T045.
- **US8 (Phase 10)**: after US5.
- **Polish**: alongside each release.

### Within Each Story

Tests first and failing, then implementation in the listed order, then the skill text, then the release task.

### Parallel Opportunities

- T002, T003 together; T006 alongside Phase 3.
- All `[P]` test tasks within a phase together.
- US2 and US6 in parallel; US4 and US5 in parallel after US3.
- T083 (dashboard export) any time after T045.

## Implementation Strategy

1. **v0.7.4 first** (Phase 1, Phase 3): restores the order gate. Nothing else ships before it.
2. **v0.8.0** (Phases 2, 4, 5, 6): the guided review with today's GTT rules. Validate with the investor for two weeks before starting v0.9.
3. **v0.9.0** (Phases 7, 8): profit lock and decisions, once the investor has chosen values (T067).
4. **v1.0.0** (Phases 9, 10): only after the investor's decision on the local engine.

Stop at any checkpoint; each release is useful on its own.
