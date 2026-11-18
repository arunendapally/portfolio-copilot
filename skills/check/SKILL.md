---
name: check
description: The guided daily review across all brokers, and portfolio checks. Use for "review", "daily review", "work through my to-dos", "do my open actions", "check my portfolio", "daily briefing", "morning briefing", "open session", "portfolio check", "pull my portfolio", "mid-day check", "end of day", "EOD analysis", "Friday review", "macro brief", "import my holdings", or any portfolio question that needs live numbers. Also the scheduled daily run.
---

# Review and check

All numbers come from the portfolio engine, a plain script (the session context gives its exact `node .../pc.js COMMAND` line; `pc` below). Show its text as is; never recompute. Broker data comes from the brokers' own MCP tools: you call them and a hook saves what they return, so you never retype a broker number.

Local engine first: if a `portfolio_status` tool is available, call it. If it answers, use `portfolio_review` (action start, next, status, decide, done, research; each takes its `pc` command's arguments, so decide takes task, decision, reason, defer_until, option), `portfolio_refresh` and `portfolio_query` instead of `pc` and the broker reads; its `next` holds only your steps. Pass a Kite request token it asks for through `portfolio_status` with `login`. On any error from it, carry on with `pc` as below.

## The review loop ("review", "daily briefing", "work through my to-dos")
Run `pc review_start` with `--folder` = the investor's folder, `tools` = every broker MCP tool name you can see (full names), and `kind`: `full` (default), `eod` for "end of day", `friday` for "Friday review". Then repeat until `stage` is `closed`:
1. Do every step in `next`, in order:
   - `call`: make exactly that tool call with exactly those arguments. A call with `only_if` runs only after the investor clicked that answer.
   - `ask`: send that question as is in the inline question UI. Never pre-fill answers. Pass the answer to the command in `then`: `task_decide` with Approve as `approved`, Defer as `deferred` (ask for a date), Decline as `declined`.
   - `manual`: show the numbered steps; wait for "done", "couldn't" or "skip"; call `task_done`.
   - `research`: look up each brief item (see below) and call `research_submit`.
   - `todoist`: apply the ops with the Todoist tools, matching tasks by the external id in their description (create, update, complete; no duplicates). Then pass `record: { todoist: "synced" }`. If Todoist is not connected, say so and ask; pass `skipped` only if the investor says skip.
   - `dashboard`: load the listed files into the investor's dashboard (their saved dashboard artifact: update its data and republish). Then pass `record: { dashboard: "updated" }`; `skipped` only on the investor's word.
   - `files`: copy the files back through the device link (below).
2. Call `pc review_next`. Show its `text`.
Task questions use Approve, Defer, Decline. Approving authorises a draft, never an order: an order runs only after "Yes, place <code>" on the draft itself. If the investor stops, the run resumes on the next "review" the same day.
After the run, open Todoist actions that are not review tasks: take them one at a time with the skill that does each (GTT work `gtt`, a stock `analyze`, risk or rebalancing `risk`, SIP, cover and buffer inputs `protection_check`); complete one only when done and verified; one no tool can do gets `report_gap`.

## Research
For each brief item, find the latest reported value of each metric from the company's results or exchange filings: give `value`, `period`, `source_url`, a short `source_quote` and `accessed` (today). If you cannot find one, submit it with `status: not_found` (or `blocked_source`) and no value; never estimate. For corporate actions, search the held symbols for bonus, split or demerger ex-dates and pass them as `corporate_actions` (an empty list when none; unconfirmed dates with `confirmed: false`).

## Macro (morning and mid-day)
Search: US close, Asian session, GIFT Nifty or Nifty, Brent, USD/INR, today's India events. Confirm each level's date is today; otherwise label it "not same-day". Give setups and levels, never direction calls. Lead with one verdict line that agrees with every number shown (the weaker of global and domestic wins).

## Quick check ("check my portfolio", no decisions)
`pc connect` with the tool names; do its `next`, ask its `manual` once, repeat until `ready`; then `pc refresh` and show its text. IBKR: pass its reads to `ingest` with `broker: "ibkr"`, `currency: "USD"`, `fx_rate` and `fx_source` (a dated USD/INR rate). No connection: "import my holdings" asks for a CSV and calls `ingest` with `csv_path`.

## Where the investor's files are
- The folder is reachable: use it as `--folder`.
- A chat linked to the PC that cannot run Node there: on the PC `pc state_export --out <file>`; copy it in; `pc state_import --bundle <file> --into <scratch>`; use `<scratch>`. Before ending, `pc state_writeback --bundle <file>` with `source_hashes` of the PC copies; copy back every file it lists; report `conflicts` and never overwrite them.
- Not linked: ask for `profile.json` (kept in the claude.ai Project); say plainly "the profile is a copy" and hand changed files back.

## Gaps
When a tool says "not supported" or errors with no fallback, call `report_gap` (title, attempted, missing, error), never with quantities, prices or P&L. If no issue was filed and a GitHub MCP is connected, file it yourself with label `gap` in `arunendapally/portfolio-copilot` (comment on an open one with the same title).

## Scheduled run (investor away)
Make the reads `pc doctor` lists once, then `pc review_start` with `unattended: true`: it never asks for a login, skips what is not live, and stops before propose; the next "review" the same day picks it up. Then the macro read. Nothing is presented as live unless the engine says live.
