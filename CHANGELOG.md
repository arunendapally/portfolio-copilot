# Changelog

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versioning: see [docs/release.md](docs/release.md).

## [0.6.0] - 2026-10-29

### Added
- `report_gap` tool: logs a capability gap to `feedback.md` and files a GitHub issue labelled `gap`, or comments on the open one with the same title. Needs `PORTFOLIO_COPILOT_GITHUB_TOKEN` or `GITHUB_TOKEN`. Retries network errors, 429 and 5xx with exponential backoff (500, 1000, 2000 ms); after 3 retries a circuit breaker fails fast for 60 s and the gap stays in the local log.
- `protection_check` and `verdict_notes` tools; profile sections `sips` and `protection`.
- `verdicts.<SYMBOL>.stop_review` (`keep` or `widen`, with `review_by`): the audit, crash test and GTT plan honour a deliberate "keep the stop" decision.
- fundamentals-analyst: fixed `Data gaps` line and a `PARTIAL:` marker when a primary source is blocked.
- Version handshake: the session hook reports the plugin name and version, and `broker_status` warns on a version or edition mismatch.
- `check` skill: "Open actions" section that works through the investor's Todoist list.

### Fixed
- A GTT plan no longer replaces a compliant GTT when only a duplicate needs deleting.

### Documentation
- README lists the `WebFetch` domains to allow for cloud sessions.

## [0.5.1] - 2026-10-26

- Orders are approved by clicking "Yes, place CODE" in an inline question; remote approval from a cloud chat linked to the PC is opt-in (`orders.allow_remote_approval`).
- `trade` verdict stance; `deployment_plan.corpus_source`.

## [0.5.0] - 2026-10-15

- `portfolio-core` engine (MCP server), approve-by-code order gate, full and lite editions, tests and evals.

## [0.4.1]

- Fix `hooks.json` schema: the plugin was failing to load.

## [0.4.0] and earlier

See the git history (`git log --oneline`).
