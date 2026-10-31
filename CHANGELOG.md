# Changelog

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versioning: see [docs/release.md](docs/release.md).

## [0.7.1] - 2026-10-31

### Fixed (#25)
- `ingest` reads the IBKR connector's `contract_description` as the symbol (also `ticker`, `tradingsymbol`) and refuses the whole call, naming the row indexes, when any row has no symbol. Before, rows collapsed into one `UNDEFINED` holding.
- `report_gap` explains a 401/403 (rejected GitHub token) and points to the local `feedback.md` log.

### Added
- `check` skill: documented stage, run, write-back flow for a cloud chat linked to the PC.

## [0.7.0] - 2026-10-30

Daily use from a plain claude.ai chat (#23): the plugin now works through the brokers' own MCPs, with no server of its own.

### Breaking
- `portfolio-core` (the MCP server), its Kite and Kotak clients and `.mcp.json` are removed. Tools are now commands of the plain script `core/bin/pc.js`; the session hook prints the exact line. `broker_login` and `execute_draft` are gone: log in with the broker MCP's own login, and orders are placed with the broker MCP's own tools.
- `orders.allow_remote_approval` is gone. Drafts, the click and the calls happen in the same chat.

### Added
- `hooks/capture.js` saves what the broker MCPs return (matched by tool-name suffix, any prefix), so broker numbers are never retyped.
- The order gate matches broker write tools by name suffix, requires the arguments to match an approved draft row exactly, and allows each row once. It also covers IBKR `create_order_instruction` and `submit_order`, and `modify_order` and `cancel_order`.
- Drafts carry the exact tool and arguments per row; basket drafts become Kite `place_order` rows. `draft_orders` drafts IBKR instructions and cancels.
- Kite "Invalid session" is reported as a login request, never as an outage; stale or missing captures are reported as such.
- Lite edition: the same gate in deny-all-writes mode.

## [0.6.1] - 2026-10-29

- Cloud approval (#9, #17): `get-started` asks once whether linked claude.ai chats may execute approved drafts (`orders.allow_remote_approval`, still off until the investor says Yes). The refusal when it is off now says what to do instead of sending the investor to a command.
- The session hook tells the model to warn once when more than one edition or version is loaded.

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
