---
name: check
description: Portfolio check across all brokers, and working through the investor's open action list. Use for "work through my to-dos", "do my open actions", "check my portfolio", "daily briefing", "morning briefing", "open session", "portfolio check", "pull my portfolio", "mid-day check", "EOD analysis", "macro brief", "import my holdings", or any portfolio question that needs live numbers. Also the scheduled daily run.
---

# Check

All numbers come from the portfolio engine, a plain script (the session context gives its exact `node .../pc.js COMMAND` line; `pc` below). Show its text as is; never recompute. Broker data comes from the brokers' own MCP tools: you call their read tools and a hook saves what they return, so you never retype a broker number.

## 1. Connect (one message)
Read with the broker MCPs, no limits or paging: Kite `get_holdings`, `get_gtts`, `get_margins`, `get_mf_holdings`, `get_orders`, `get_trades`; Kotak Neo `get_holdings`, `get_limits`. Then run `pc broker_status` (pass `--folder` = the investor's folder, and the hook plugin and version from the session context).
- Live brokers: say nothing more.
- `needs_login`: Kite: call the Kite MCP `login` tool, show its link only, wait for "done", read again. Kotak: its `get_login` with the UCC from the profile, the QR step, then `validate_login`, read again.
- `outage`: say the broker is down and do not ask for a login.
- `not_connected`: that broker's MCP is not available in this chat. Say which, and go on with the others.
- Never write a login URL yourself.

## 2. Pull
Run `pc refresh`. If an IBKR connector is available, call its `get_account_summary` (primary), then `get_account_positions`, and pass them to `ingest` with `broker: "ibkr"`, `currency: "USD"`, and `fx_rate` + `fx_source` (a dated USD/INR rate; say where it came from). If summary fails, ingest positions and say the cash figure is last known.
For a broker with no connection, "import my holdings": ask for a CSV export and call `ingest` with `csv_path`.

## 3. Macro (morning and mid-day only)
Search: US close, Asian session, GIFT Nifty or Nifty, Brent, USD/INR, today's India events. Before using any level, confirm its date is today's date; otherwise label it "not same-day" and keep it out of the verdict. Give setups and levels, never direction calls.
Also search held stock symbols for upcoming bonus, split or demerger ex-dates. If any, run the `gtt` skill's audit with `corporate_actions` (mark unconfirmed dates as `confirmed: false`).

## 4. Report
1. One-line verdict that agrees with every number shown (re-read before sending; the weaker of global and domestic wins).
2. The `refresh` text: broker lines, needs attention, changes since last snapshot, brokers, positions, allocation.
3. Macro table (morning) and any corporate-action GTT risk.
4. Close (EOD): add `gtt_audit` summary line.
SIP status is not readable from any broker: call `protection_check` to show the SIPs the investor has confirmed; if none are saved, ask, don't infer, and save them with `profile_update` only after they confirm.

## 5. Log
Call `log_append` with a 3-5 line entry (what was pulled, totals, what changed, anything flagged). Rewrite `start_here` only when goals, next actions or decisions owed change. Never edit a verdict; log the contradiction.

## Open actions ("work through my to-dos")
1. Read the open actions: the Todoist project for portfolio actions (Todoist tools, find-tasks; ask which project if unclear), else the "Start here" block of the log.
2. Take them one at a time. Map each to the skill or tool that does it: GTT work to `gtt`, a stock review to `analyze`, risk, buffer or rebalancing to `risk`, a number the investor holds to `profile_update`, SIP, cover and buffer inputs to `protection_check`.
3. Run it. Ask the investor only for inputs the plugin cannot get (a number, a decision). Never guess one.
4. Complete the Todoist task (complete-tasks) only after the work is done and verified, and `log_append` it. An action no tool can do stays open: call `report_gap` for it.

## Gaps
When a tool says "not supported", a known limitation, or errors with no fallback, call `report_gap` (title, what was attempted, what is missing, the error). Never put quantities, prices or P&L in it. Then tell the investor where it was logged.

## Scheduled run (investor away)
Do not wait for logins. Run `broker_status` once, then `check` (last snapshot, clearly dated) and the macro read, then one line per broker that needs login. Nothing is presented as live unless the tool says live.
