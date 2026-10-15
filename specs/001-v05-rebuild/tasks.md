# Tasks: portfolio-copilot v0.5 rebuild

**Input**: plan.md, spec.md, data-model.md, contracts/. Tests are mandatory (constitution VII).
`[P]` = parallelizable. `[USn]` = user story.

## Phase 1: Setup

- [x] T001 Create `core/`, `core/lib/brokers/`, `tests/fixtures/`, `scripts/`, `evals/`, `.github/workflows/`
- [x] T002 [P] Add `package.json` (no deps; scripts: `test`, `build`) and `.gitattributes` (LF)
- [x] T003 [P] Update `.gitignore`: `dist/`, `portfolio-copilot/` state folder, eval runs

## Phase 2: Foundation (blocks all stories)

- [x] T004 `core/server.js`: stdio JSON-RPC MCP server (initialize, tools/list, tools/call), edition switch
- [x] T005 `core/lib/state.js`: folder resolution, JSON read/write, snapshots (keep 30), session store 0600
- [x] T006 `core/lib/profile.js`: defaults, deep-merge load, validation by path, update
- [x] T007 `core/lib/format.js`: INR formatting, markdown tables, IST timestamps
- [x] T008 [P] Tests: `tests/server.test.js`, `tests/state.test.js`, `tests/profile.test.js`

## Phase 3: US1 Connect once (P1)

- [x] T009 [US1] `core/lib/mcp-client.js`: streamable-HTTP client, session id persist, one retry, SSE parse, error classes
- [x] T010 [US1] `core/lib/brokers/kite.js`: login, status probe, classify (research R2), paged fetchers
- [x] T011 [US1] `core/lib/brokers/kotak.js`: get_login/validate, holdings CSV parse, limits, order book
- [x] T012 [US1] Tools `broker_status`, `broker_login`; links only from tool output
- [x] T013 [P] [US1] Tests with a local fake MCP HTTP server: retry, classification, session reuse, link provenance

## Phase 4: US2 Daily check (P1)

- [x] T014 [US2] `core/lib/brokers/normalize.js`: Kite holdings/MF/GTT/margins/orders/trades; Kotak rows
- [x] T015 [US2] `core/lib/snapshot.js`: consolidate, weights with base, cash vs buffer, diff vs previous, folio count, negative-margin floor
- [x] T016 [US2] `core/lib/audit.js`: verdict/cash/cap contradictions; GTT vs manual fills
- [x] T017 [US2] Tools `refresh`, `ingest`, `check`; unverified carry-forward counts
- [x] T018 [P] [US2] Tests on scrubbed fixtures: determinism (10 runs identical), diff, audit, floor, ingest FX

## Phase 5: US3 GTT audit (P1)

- [x] T019 [US3] `core/lib/gtt.js`: classify by policy, qty gaps both ways, crash test, outliers, double coverage, orphans, cancelled since last, corp-action re-score, live-price proximity
- [x] T020 [US3] Tools `gtt_audit`, `draft_gtt_plan` (place first, then delete)
- [x] T021 [P] [US3] Tests: seeded book detects 100% of seeded issues; overrides respected

## Phase 6: US4 Orders from approved drafts (P1)

- [x] T022 [US4] `core/lib/drafts.js`: codes, hash, approve, verify, expiry
- [x] T023 [US4] `hooks/approve.js` (UserPromptSubmit), `hooks/order-gate.js` (PreToolUse), `hooks/hooks.json`
- [x] T024 [US4] Tool `execute_draft` (full only): places then verifies then deletes; manual-delete fallback
- [x] T025 [P] [US4] Tests: gate allow/deny matrix, mismatch by field, pre-detail "yes", fail-closed, lite has no execute

## Phase 7: US5 Basket, US6 Crash, US7 Onboarding (P2)

- [x] T026 [US5] `core/lib/basket.js` + tool `draft_basket`; tests
- [x] T027 [US6] `core/lib/crash.js` + tool `crash_check`; `core/lib/rates.js` + tool `rate_map`; tests
- [x] T028 [US7] Tools `profile_get`, `profile_update`, `log_append` with monthly rotation; tests

## Phase 8: Skills, agent, hooks text (US2-US8)

- [x] T029 Replace skills with 6: get-started, check, gtt, risk, crash, analyze (old trigger phrases in descriptions)
- [x] T030 [US8] fundamentals-analyst: tools list, bounded search, sources; analyze skill delegates
- [x] T031 `context/house-rules.md` + `hooks/session-start.js` updated; `.mcp.json` = portfolio-core only

## Phase 9: US9 Delivery

- [x] T032 `scripts/build.js`: full + lite into `dist/`, `.plugin` zips; marketplace lists both
- [x] T033 `tests/policy-lint.test.js` (T9) and `tests/hooks-config.test.js` (matcher covers all known names)
- [x] T034 Move `evals/run-evals.py` into repo, parametrise paths, add T0 and T2
- [x] T035 `.github/workflows/ci.yml`: node tests + build + validate on PR
- [x] T036 README, DISCLAIMER check, `plugin.json` 0.5.0, docs/release.md
- [ ] T037 Run all tests, build, validate (done), evals: T0 PASS both editions; T1-T3 blocked by expired local `claude` login, rerun after `/login`

## Phase 10: Release follow-ups (open; start here)

Context: v0.5.0 is implemented on branch `claude/investment-feedback-spec-3cdd34`, PR
https://github.com/arunendapally/portfolio-copilot/pull/2. 79 unit tests pass, strict validate
passes, eval T0 passes for both editions. Work in this branch; push to update the PR.
`[ARUN]` = needs the investor's own action (login, approval, sending); stop and ask.

- [x] T038 [ARUN] Confirm the local `claude` CLI is logged in (`claude -p "ok"` succeeds); if not, ask Arun to run `/login` — 15-Oct: evals run from the cloud Cowork CLI (logged in); local CLI not checked
- [x] T039 Run `python evals/run-evals.py` (T0-T2) and `--probes T3 --analyze-symbol TITAN`; for each FAIL, fix the plugin (or the probe if it is wrong, with a reason), add a unit test where the fix is deterministic, re-run until PASS; `node --test tests/*.test.js` and `node scripts/build.js` after every change — 15-Oct: T0-T2 PASS (full), T0 PASS (lite). T3 REVIEW: the reply passed on unquoted search-summary numbers; fixed in the agent + analyze skill (test added), probe now allows `log_append`; re-run shows no unquoted figures. T3 data path still to run locally (cloud WebFetch blocked)
- [x] T040 Check PR #2 CI (`gh pr checks 2`); fix any failure (Windows / Node 18 are the likely ones), push — 15-Oct: ubuntu/Node 18 failed (keep-alive sockets survive `server.close()` in the outage test); fixed, all 5 checks green
- [ ] T041 [ARUN] Read-only smoke test with real logins per `quickstart.md`; if Kotak holdings fail to parse, read `~/.portfolio-copilot/raw/kotak-holdings.txt`, extend the header aliases in `core/lib/brokers/normalize.js`, add a scrubbed fixture + test — 15-Oct (step 4): `gtt_audit` reported "6 findings, not listed". Cause: Claude Code passes `structuredContent` to the model instead of the `text`, so every report's tables were lost. Fixed in `core/server.js` (text only), test added. Re-run steps 1-5 on the new build
- [ ] T042 Draft a GitHub issue for zerodha/kite-mcp-server (no existing issue found on 14 Oct): `delete_gtt_order` / `modify_gtt_order` return "parameter 'trigger_id': is required" with a numeric id since 30-Sep-2026 while `place_gtt_order` works; unauthenticated probes in `research.md` R3; ask whether the hosted server disables them on purpose (its README says destructive operations are excluded). Save to `docs/upstream/kite-delete-gtt-issue.md`; [ARUN] posts it — 15-Oct: drafted. Server code shows "is required" only fires when the key is missing, so the client path may be dropping it; the draft asks. Waiting on [ARUN] to post
- [ ] T043 Comment eval and smoke results on PR #2; [ARUN] merges and tags v0.5.0 per `docs/release.md`
- [ ] T044 After merge: update `C:\Arun-Personal\Investment\CLAUDE.md` execution playbook (tools now via portfolio-core; orders need `approve <code>`; drop `plugin_portfolio-copilot_kite__*` names) and the 📌 roadmap in `feedback.md` (fix list 1-6 done, dogfood next)
- [ ] T045 [ARUN] In the Investment folder: "get started" then "import my notes" to move rules into `portfolio-copilot/profile.json`; [ARUN] upload `portfolio-copilot.plugin` to claude.ai and confirm T0 in a fresh cloud Cowork session
