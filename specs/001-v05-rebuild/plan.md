# Implementation Plan: portfolio-copilot v0.5 rebuild

**Branch**: `001-v05-rebuild` | **Date**: 2026-10-14 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/001-v05-rebuild/spec.md`

## Summary

Move every deterministic job (broker connection, payload parsing, arithmetic, policy, state,
drafts, order gating) out of the model and into `portfolio-core`, a zero-dependency Node MCP
server bundled with the plugin. Core connects to the hosted Kite and Kotak MCP endpoints itself
(research R1), owns and persists their sessions (R2), and returns small, pre-computed results.
Skills shrink to 6 thin workflows. Orders run only from drafts the user approved by code (R4).
Both editions are built from one source; unit tests and evals gate every change.

## Technical Context

**Language/Version**: JavaScript, Node >= 18 (developed on 24)

**Primary Dependencies**: none at runtime (built-in `fetch`, `crypto`, `fs`, `node:test`)

**Storage**: JSON and markdown files in the user's working folder; session ids in `~/.portfolio-copilot/`

**Testing**: `node --test` (unit, fixtures); `evals/run-evals.py` (model behaviour via `claude -p`)

**Target Platform**: Claude Code CLI and Cowork on Windows, macOS, Linux

**Project Type**: Claude plugin (skills + hooks + bundled MCP server)

**Performance Goals**: daily check < 60 s and < 30K tokens after login; core tool responses < 5 KB typical

**Constraints**: no personal data in repo; lite edition cannot place orders; no private broker endpoints

**Scale/Scope**: books up to ~150 holdings and ~150 GTTs; 1-5 brokers per user

## Constitution Check

| Principle | Status |
|---|---|
| I. Drafts, user executes | PASS: drafts + approval codes + command hooks (R4); lite has no execute tool |
| II. Numbers from code | PASS: all figures from core tools |
| III. Analysis, not advice | PASS: house rules unchanged in substance; analyze skill + agent audit |
| IV. One connection per broker | PASS: core is the only Kite/Kotak client; `.mcp.json` drops both proxies |
| V. State is data | PASS: profile.json, snapshots, rotated log |
| VI. Simple and fast | PASS: 6 skills, zero deps, budgets tested |
| VII. Tests gate releases | PASS: unit tests + validate + T9 in CI, T0-T3 pre-release |

Post-design re-check: PASS, no exceptions.

## Project Structure

### Documentation (this feature)

```text
specs/001-v05-rebuild/
├── plan.md  research.md  data-model.md  quickstart.md
├── contracts/core-tools.md   contracts/hooks.md
└── tasks.md
```

### Source Code (repository root)

```text
.claude-plugin/        plugin.json, marketplace.json (full + lite)
.mcp.json              portfolio-core only
core/
├── server.js          stdio MCP server, tool registry, edition switch
├── tools.js           tool definitions -> handlers
└── lib/
    ├── mcp-client.js  streamable-HTTP MCP client: session persist, retry once, SSE parse
    ├── brokers/kite.js   kotak.js   normalize.js
    ├── state.js       folder resolution, profile load/validate/update, snapshots, log rotation
    ├── profile.js     defaults + schema validation + migration
    ├── snapshot.js    consolidation, weights with base, diff vs previous
    ├── audit.js       trade audit vs verdicts / cash / caps
    ├── gtt.js         policy classification, qty gaps, crash test, corp actions, plan draft
    ├── basket.js      basket rows
    ├── crash.js       stage detection, stop review
    ├── rates.js       rate-sensitivity default table
    ├── drafts.js      create, approve (hash), verify, execute ordering
    └── format.js      compact markdown tables
hooks/
├── hooks.json
├── session-start.js   house rules + degraded-protection notice
├── approve.js         UserPromptSubmit: record "approve <code>"
└── order-gate.js      PreToolUse: allow only approved-draft matches
skills/                get-started, check, gtt, risk, crash, analyze
agents/fundamentals-analyst.md
context/house-rules.md
tests/                 *.test.js + fixtures/ (scrubbed)
evals/                 run-evals.py, README.md
scripts/build.js       dist/portfolio-copilot(.plugin) and dist/portfolio-copilot-lite
.github/workflows/ci.yml
```

**Structure Decision**: single plugin repo; `core/` is the only code; skills and hooks stay
where the plugin loader expects them.

## Complexity Tracking

None.
