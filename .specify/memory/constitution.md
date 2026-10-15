<!--
Sync Impact Report
- Version change: template -> 1.0.0 (initial ratification)
- Principles added: I. Plugin Drafts, User Executes; II. Numbers Come From Code;
  III. Analysis, Not Advice; IV. One Connection Per Broker; V. State Is Data;
  VI. Simple and Fast by Budget; VII. Release Only When Tests Pass
- Sections added: Constraints, Development Workflow, Governance
- Templates: plan-template.md OK (generic Constitution Check gate reads this file);
  spec-template.md OK; tasks-template.md OK (test tasks required by Principle VII)
- Deferred TODOs: none
-->

# portfolio-copilot Constitution

## Core Principles

### I. Plugin Drafts, User Executes (NON-NEGOTIABLE)

- The plugin MUST NOT place, modify, or cancel any broker order unless the exact order
  (instrument, side, quantity, trigger/price, product) was shown and the user approved that
  specific order. A blanket "yes" does not count.
- Order safety MUST be enforced in code: a PreToolUse command hook allows an order tool call
  only if it matches an approved draft exactly. A model-judged prompt hook is a fallback only.
- The default output for any action is a draft (GTT plan, basket row list) the user executes.
  The lite edition has no execution path at all.

Rationale: real money, and the 30-Sep cloud session placed 33 GTTs with no hook loaded.

### II. Numbers Come From Code

- Every figure shown to the user (quantities, values, P&L, percentages, gaps, crash tests)
  MUST come from a `portfolio-core` tool output or a live broker pull, with a timestamp and,
  for percentages, the denominator named.
- The model MUST NOT parse raw broker payloads or do portfolio arithmetic in context.
- Missing or stale data MUST be stated plainly; never estimated silently.

Rationale: in-context parsing broke on 70K-char GTT payloads and gave different answers
run to run.

### III. Analysis, Not Advice

- The plugin MUST NOT suggest securities to buy. It analyzes what the user holds or names.
- Market commentary gives setups and levels, never direction forecasts; global macro is
  checked before India positioning.
- User-saved thresholds, policies and verdicts override defaults. Verdicts are never edited
  silently; contradictions are logged.

Rationale: not SEBI-registered; directory policy and user trust.

### IV. One Connection Per Broker

- Each broker is reached through exactly one MCP server, connected natively (streamable HTTP
  where offered). No local proxies (`npx mcp-remote`) in shipped config.
- If the user already has a connector for a broker, the plugin MUST use it and not start a
  second one. Skills refer to tools by capability, not by a hardcoded server prefix.
- Login is always user-initiated. Login links shown to the user MUST come from a login tool's
  output. Broker status is reported per broker (live / needs login / outage).

Rationale: duplicate servers caused double logins, dropped sessions and ambiguous hook matching.

### V. State Is Data

- Per-user state lives in one folder: `profile.json` (schema-versioned), dated JSON snapshots,
  and a rotated `log.md` with a short "Start here" block.
- Rules (GTT policy, thresholds, allocation targets, cash buffer location) live in the profile
  with plugin defaults; they are encoded once, in `portfolio-core`, never restated per skill.
- No personal data in the repo.

Rationale: 300 KB of growing markdown read every session does not scale and drifted.

### VI. Simple and Fast by Budget

- At most 6 user-facing skills, each under 60 lines, with no duplicated rules.
- Session start reads at most 20 KB of state. A daily check after login completes in under
  60 s and under 30K tokens on a 50-holding book.
- `portfolio-core` is Node with no runtime dependency beyond the MCP SDK. No speculative
  features, flags or abstractions.

Rationale: the user asked for simple, integrated and fast; budgets make that testable.

### VII. Release Only When Tests Pass

- Every PR runs: `claude plugin validate --strict`, hook-matcher unit tests, `portfolio-core`
  unit tests on recorded (scrubbed) payloads, and the policy lint.
- Every release additionally passes evals T0 (loads), T1 (house rules), T2 (order gate),
  T3 (analysis integrity) on the built artifact. Evals never call a live broker order tool.
- No upload to claude.ai or marketplace tag without a green run.

Rationale: v0.4.0 shipped a hooks.json that disabled every guardrail.

## Constraints

- Platforms: Windows, macOS, Linux; Claude Code CLI and Cowork (desktop and cloud).
- Two editions from one source: full (bundles broker MCPs, can execute after approval) and
  lite (no bundled order-capable MCP, drafts only; candidate for Anthropic's directory, §4.A).
- Regulatory: SEBI IA/RA rules (no personalized buy calls); retail algo framework
  (no automated order loops). Broker daily token expiry is a given, not a bug to work around.
- Known connector limits (Kite `delete/modify_gtt_order`, no MF/SIP endpoint, Kotak CSV
  blobs) are handled by design (place-then-delete drafts, explicit "unknown"), not by
  private or undocumented endpoints.

## Development Workflow

- Spec Kit flow: specify -> clarify -> plan -> tasks -> implement, one feature folder per
  change under `specs/`.
- Field feedback from the user's `feedback.md` is the input backlog; each item maps to a
  requirement or is listed as out of scope with a reason.
- Tests are written with or before the code they cover. Deterministic logic gets unit tests;
  model behaviour gets evals.
- Version bumps follow semver in `plugin.json`; README and marketplace entries are updated in
  the same PR.

## Governance

- This constitution overrides other project guidance. Amendments need a PR that states the
  change, bumps the version (MAJOR: principle removed or redefined; MINOR: principle or
  section added; PATCH: wording) and updates dependent templates.
- Every plan's Constitution Check lists each principle as pass or justified exception.
  Unjustified violations block the PR.
- Runtime house rules (`context/house-rules.md`) MUST stay consistent with Principles I-III.

**Version**: 1.0.0 | **Ratified**: 2026-10-14 | **Last Amended**: 2026-10-14
