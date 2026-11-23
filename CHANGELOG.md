# Changelog

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versioning: see [docs/release.md](docs/release.md).

## [1.1.0] - 2026-11-19

The issue backlog (#23, #33 to #41): setups, a watchlist, a deployment split, Kite basket files, intraday plans and a retro. Every figure comes from the investor's own data or reads; the new commands describe charts and levels and never suggest a security.

### Added
- `setups` (#34): In uptrend, Dip in uptrend, Stretched, Downtrend or Short history per holding and watchlist name, with R:R (room to the 52-week high over room to the 20-day low), from the engine's own daily closes. `closes_seed` loads daily closes from a broker's historical data so a name does not wait 50 refreshes.
- `watchlist` (#35): names and saved screens kept in `profile.watchlist`; `record_results` stores what a screen returned (screen output, not recommendations) and every name shows its setup. Run by the investor's browser; the plugin never scrapes.
- `deploy` (#38): broker cash split by the global gap, the saved destination weights, index valuation (`valuations`) and setup; gold and silver in halves; a Stretched or Downtrend name takes half now; the held-back part stays cash; optional dip limits at the 20-day low with a deadline, as proposals only. Returns the amount and destinations for `draft_basket`.
- `draft_basket` with `format: kite_json` (#39) writes a file for Kite web's basket import. The format is unverified until an import is confirmed.
- `intraday_plan`, `intraday_watch` (#36): opening range, VWAP and 20 EMA from 5-minute candles, a stop below structure, quantity sized to a per-trade risk, charges netted, net R:R; calls are logged and watched against prices. Charge rates come from `profile.charges` (with date and source); the built-in default is flagged as unverified wherever it is used.
- `retro` (#37): replays a day's logged calls against the candles that followed (a candle touching both stop and target counts as stopped) with net after charges and the losses against the loss tolerance.
- `close_session` (#41): a dated session summary and an optional new Start here block in the log; refuses a folder with no profile.json.
- The check shows open play losses against the loss tolerance (#40); the dashboard export carries `setup` and `rr` per position and a `watchlist-<date>.json` file (#33).

### Notes
- #23 (daily use from the chat through the brokers' own MCPs) shipped in 0.7.0 and is covered by the 1.0.0 review loop.
- #35's screener and #36's active watching are guided by the `analyze` skill; the plugin holds the data and the arithmetic, the chat does the browsing and the polling.

## [1.0.0] - 2026-11-18

Keep the gains, decide by your own rules, see the tax, and let a local engine do the reading (spec 002, US4, US5, US7, US8).

### Added
- Profit lock (off until you save every value; no defaults): past your arm threshold a task raises the stop to cost, past your booking threshold a task sells your share with where the proceeds go, and after that the stop follows the highest close. Stops only move up; funds are never in scope; locked names are exempt from the minimum stop distance and shown in their own crash-test column. A buy back inside your cooling-off is flagged. `profit_lock_dryrun` shows what would happen today at any values; `core/bin/backtest-profit-lock.js` replays your own tradebook to help you choose them.
- Tax on every sell: `lots_build` reads your tradebook and fund statement (CSV), builds lots first-in first-out and reconciles them to what you hold. Every sell option then shows the lots it uses, short or long term for each, the gains, how much of your yearly long-term exemption it uses and what is left, and the tax at the rates you saved with their date, always with "confirm with your tax adviser". Near the year end a task shows unused exemption beside long-term gains held.
- Every task option shows its effect on allocation (bucket before and after, with target) and its tax.
- The review closes only when the log, journal, bundle, Todoist and your dashboard are updated; it says which, if you chose to skip one. `export --format dashboard` writes the dashboard files.
- Local engine (optional, full edition): a read-only process on your computer reads Kite (free Personal plan of Kite Connect, one login a day) and IBKR (Flex Web Service), and serves four summary tools to Claude, so a review spends tokens only on research and wording. Kotak stays in chat. It never places, changes or deletes anything. See README "Local engine".
- Technicals (50 and 200-day averages, RSI 14, 20-day low, 52-week high) from the engine's own daily closes, once there are enough of them, dated.
- Eval T5: a review through the local engine on fixture data.
- The review and the new `decisions` command evaluate your saved rules: single stock, sector (with its base, and sector funds when your map lists them) and fund-house limits; drift bands per bucket (closing with new money first, with the amount); tripwires from sourced, dated research findings (for the number of quarters you set; "not found" never triggers); your plan path (the monthly change that closes the gap); and loss tolerance on play trades (realised plus open; realised losses join once your tradebook is loaded). A rule with no saved threshold is listed once as "not set".
- `journal_readback`, and the Friday review reads back decisions older than `review.readback_after_days` beside what the same rule measures now.
- `check` shows a guardrails table: largest stock, sector and fund house against their limits with bases, and the closest stop.
- get-started collects bands, the sector map, classes, tripwires, the plan path and loss tolerance; "import my notes" shows a diff against the profile.

### Changed
- An unattended review evaluates, then waits before propose; the next "review" the same day picks it up (FR-025).
- A GTT plan for named symbols no longer also deletes an unrelated orphan GTT.
- Constitution 2.0.0: Principle IV allows one read-only local collector per broker, with conditions.

### Security (independent review before release)
- Approvals and used-row markers are sealed in the per-machine folder; a draft file edited to say "approved" is not an approval.
- A guard hook blocks file and shell tools from drafts and from the per-machine folder (approvals, key, broker secrets).
- Bundles accept only paths inside the state folder that match their manifest; drafts travel as drafts, never approved.
- The order gate compares nested order arguments field by field, denies write-like unknown tools on every broker, and treats IBKR alert, watchlist and screener changes as writes.
- The IBKR Flex token is sent only to IBKR's own hosts.

### Fixed (review before release)
- Profit lock: the cost stop rounds up so the lock arms; the high follows closes, not intraday prices.
- Two tasks for one stock share one draft; a failed verify cannot be waived by asking again.
- A sell with no current price says tax is not computed; last year's realised gains no longer use this year's exemption.
- The bundle never sends back a shortened journal; dates use IST throughout.
- Task ids stay the same when a measurement moves a little, so a deferred task stays deferred.
- The extra monthly amount for the plan path accounts for the gap growing.
- Blocked tasks log a gap and come with steps to do by hand; follow-up commands find today's open run of any kind; decisions record whether they came from your click.

## [0.8.0] - 2026-11-17

The guided daily review (spec 002, US2, US3, US6).

### Added
- `review`: one run per day through connect, pull, research, evaluate, propose, execute, verify and record, with each gate in code. At most five tasks, safety first, each with the rule and the measurements behind it (with their base and time). Approve, defer or decline; an approval authorises a draft, never an order. Approved tasks are drafted (the order still needs "Yes, place <code>") or given as numbered steps, then checked against a fresh broker read. The run resumes the same day; a deferred task stays away until its date. `end of day` and `Friday` runs; unattended runs stop after research.
- `connect`: every broker live or skipped before any work; all logins asked at once. `broker_status` is now its alias.
- One state wherever you chat: `state_export`, `state_import`, `state_writeback` (conflicts are reported, never overwritten).
- Profile schema v2 (new fields default to empty; v1 profiles migrate on load). `log.path` can point at your own log file (append-only).
- Every holding carries the time of its price; the fresher price wins across brokers; a holding priced at cost two runs in a row is valued at zero and listed (override in `valuation_overrides`); a fund at two brokers is one position; same-day buys count toward GTT coverage.

### Changed
- Drafting commands refuse without a real profile. A failed write (log, feedback, profile) fails the command.
- The order gate also denies a review task question sent with its answer filled in.
- Evals run against a fake generation-2 Kite MCP with no user settings loaded.

## [0.7.4] - 2026-11-15

Hotfix: Kite renamed its MCP tools on 11-Nov-2026 (grouped tools picked by `mode`). The order gate matched verbs in tool names, so the new writes were not gated, and capture missed every new read.

### Fixed
- One broker tool map, `core/lib/brokers/toolmap.js`, is the only place broker tool names live. It resolves a tool to broker, kind, capability and generation, and builds write calls, full-list reads and the doctor report from that.
- Hooks match brokers, not verbs. The gate denies every Kite and IBKR write without an approved draft row (`mode` included) and denies tools it does not know; unknown Kotak reads pass and are queued as gaps.
- Capture files are named by capability; a partial read is judged by the broker's pagination; renamed tools show as `tools_changed`, not as a login or outage.
- Kotak cash is read from the limits CSV; unreadable cash is reported as `format_error`.
- Drafts name calls through the map for the Kite generation in use. The broker's own approval step is shown, never approved by Claude.
- Skills describe capabilities, not tool names; a test keeps tool names out of them.

### Added
- `pc doctor` names the exact read and write calls per enabled broker and lists tools it does not know; `report_gap --flush`; a doctor line at session start.

## [0.7.3] - 2026-11-11

### Fixed (#31)
- A broker read made with `limit` or `from` holds only part of the list, so `broker_status` no longer treats it as the full read: it reports the read as stale and names it ("get_gtts was read with limit=1 ... call it again without limit or from"). Before, a one-row `get_gtts` made Kite look live and the GTT audit would see every other holding as unprotected.
- The stale message names only the reads that are old, not all three.

### Fixed (#30)
- "Largest positions" shows a Kite mutual fund by its fund name, not its ISIN. The position symbol stays the ISIN, so profile mappings and the change diff are unaffected.

### Fixed (#29)
- Holdings in a foreign currency (IBKR US ETFs such as VOO and QQQM, ingested with `type: etf`) are bucketed `global_equity`, not `india_equity`. Before, only `type: foreign` was global, so the global gap was overstated. `rate_map` likewise lists them as foreign equity instead of unclassified. A USD gold or debt ETF also reads as global equity now; map it in `allocation.symbol_buckets`.

### Fixed (#28, #32)
- With no `profile.json` in the investor folder, every tool that computes from the profile now opens with a warning that it is using defaults (Kite only, no verdicts, no sector map) and that GTT, allocation and sector findings may be wrong. Before, only `profile_get` said so, and a stale folder copy produced wrong GTT drafts without a word.
- A Kite holding with an `INF` ISIN is typed `etf` even when its name has no ETF marker and the profile does not list it.

## [0.7.2] - 2026-11-06

### Fixed
- Kite and Kotak Neo ask for a login again when you are logged out. Since 0.7.0 a failed broker read was never captured (Claude Code sends errors to `PostToolUseFailure`, not `PostToolUse`), so `broker_status` said "not connected" and the `check` skill skipped the broker. The capture hook now also runs on `PostToolUseFailure`, and the Kite MCP's "Failed to execute" is read as a login request.
- `check` skill: Kotak starts with its login, since its reads need the `sessionid`; any errored read leads to a login, and "not connected" is only for a broker whose MCP is absent.

## [0.7.1] - 2026-10-31

### Fixed (#25)
- `ingest` reads the IBKR connector's `contract_description` as the symbol (also `ticker`, `tradingsymbol`) and refuses the whole call, naming the row indexes, when any row has no symbol. Before, rows collapsed into one `UNDEFINED` holding.
- `report_gap` explains a 401/403 (rejected GitHub token) and points to the local `feedback.md` log. The `check` skill now files the gap through a connected GitHub MCP when the token route fails, so a cloud chat needs no token.

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
