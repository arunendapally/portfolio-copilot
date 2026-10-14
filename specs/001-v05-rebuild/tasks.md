# Tasks: portfolio-copilot v0.5 rebuild

**Input**: plan.md, spec.md, data-model.md, contracts/. Tests are mandatory (constitution VII).
`[P]` = parallelizable. `[USn]` = user story.

## Phase 1: Setup

- [ ] T001 Create `core/`, `core/lib/brokers/`, `tests/fixtures/`, `scripts/`, `evals/`, `.github/workflows/`
- [ ] T002 [P] Add `package.json` (no deps; scripts: `test`, `build`) and `.gitattributes` (LF)
- [ ] T003 [P] Update `.gitignore`: `dist/`, `portfolio-copilot/` state folder, eval runs

## Phase 2: Foundation (blocks all stories)

- [ ] T004 `core/server.js`: stdio JSON-RPC MCP server (initialize, tools/list, tools/call), edition switch
- [ ] T005 `core/lib/state.js`: folder resolution, JSON read/write, snapshots (keep 30), session store 0600
- [ ] T006 `core/lib/profile.js`: defaults, deep-merge load, validation by path, update
- [ ] T007 `core/lib/format.js`: INR formatting, markdown tables, IST timestamps
- [ ] T008 [P] Tests: `tests/server.test.js`, `tests/state.test.js`, `tests/profile.test.js`

## Phase 3: US1 Connect once (P1)

- [ ] T009 [US1] `core/lib/mcp-client.js`: streamable-HTTP client, session id persist, one retry, SSE parse, error classes
- [ ] T010 [US1] `core/lib/brokers/kite.js`: login, status probe, classify (research R2), paged fetchers
- [ ] T011 [US1] `core/lib/brokers/kotak.js`: get_login/validate, holdings CSV parse, limits, order book
- [ ] T012 [US1] Tools `broker_status`, `broker_login`; links only from tool output
- [ ] T013 [P] [US1] Tests with a local fake MCP HTTP server: retry, classification, session reuse, link provenance

## Phase 4: US2 Daily check (P1)

- [ ] T014 [US2] `core/lib/brokers/normalize.js`: Kite holdings/MF/GTT/margins/orders/trades; Kotak rows
- [ ] T015 [US2] `core/lib/snapshot.js`: consolidate, weights with base, cash vs buffer, diff vs previous, folio count, negative-margin floor
- [ ] T016 [US2] `core/lib/audit.js`: verdict/cash/cap contradictions; GTT vs manual fills
- [ ] T017 [US2] Tools `refresh`, `ingest`, `check`; unverified carry-forward counts
- [ ] T018 [P] [US2] Tests on scrubbed fixtures: determinism (10 runs identical), diff, audit, floor, ingest FX

## Phase 5: US3 GTT audit (P1)

- [ ] T019 [US3] `core/lib/gtt.js`: classify by policy, qty gaps both ways, crash test, outliers, double coverage, orphans, cancelled since last, corp-action re-score, live-price proximity
- [ ] T020 [US3] Tools `gtt_audit`, `draft_gtt_plan` (place first, then delete)
- [ ] T021 [P] [US3] Tests: seeded book detects 100% of seeded issues; overrides respected

## Phase 6: US4 Orders from approved drafts (P1)

- [ ] T022 [US4] `core/lib/drafts.js`: codes, hash, approve, verify, expiry
- [ ] T023 [US4] `hooks/approve.js` (UserPromptSubmit), `hooks/order-gate.js` (PreToolUse), `hooks/hooks.json`
- [ ] T024 [US4] Tool `execute_draft` (full only): places then verifies then deletes; manual-delete fallback
- [ ] T025 [P] [US4] Tests: gate allow/deny matrix, mismatch by field, pre-detail "yes", fail-closed, lite has no execute

## Phase 7: US5 Basket, US6 Crash, US7 Onboarding (P2)

- [ ] T026 [US5] `core/lib/basket.js` + tool `draft_basket`; tests
- [ ] T027 [US6] `core/lib/crash.js` + tool `crash_check`; `core/lib/rates.js` + tool `rate_map`; tests
- [ ] T028 [US7] Tools `profile_get`, `profile_update`, `log_append` with monthly rotation; tests

## Phase 8: Skills, agent, hooks text (US2-US8)

- [ ] T029 Replace skills with 6: get-started, check, gtt, risk, crash, analyze (old trigger phrases in descriptions)
- [ ] T030 [US8] fundamentals-analyst: tools list, bounded search, sources; analyze skill delegates
- [ ] T031 `context/house-rules.md` + `hooks/session-start.js` updated; `.mcp.json` = portfolio-core only

## Phase 9: US9 Delivery

- [ ] T032 `scripts/build.js`: full + lite into `dist/`, `.plugin` zips; marketplace lists both
- [ ] T033 `tests/policy-lint.test.js` (T9) and `tests/hooks-config.test.js` (matcher covers all known names)
- [ ] T034 Move `evals/run-evals.py` into repo, parametrise paths, add T0 and T2
- [ ] T035 `.github/workflows/ci.yml`: node tests + build + validate on PR
- [ ] T036 README, DISCLAIMER check, `plugin.json` 0.5.0, docs/release.md
- [ ] T037 Run all tests, build, validate, evals T0-T2 locally; fix; push; open PR
