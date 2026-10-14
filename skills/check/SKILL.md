---
name: check
description: Portfolio check across all brokers. Use for "check my portfolio", "daily briefing", "morning briefing", "open session", "portfolio check", "pull my portfolio", "mid-day check", "EOD analysis", "macro brief", "import my holdings", or any portfolio question that needs live numbers. Also the scheduled daily run.
---

# Check

All numbers come from portfolio-core tools. Show each tool's `text` as is; never recompute.

## 1. Connect (one message)
Call `broker_status` (pass `folder` = the investor's working folder on the first call).
- Live brokers: say nothing more.
- `needs_login`: show only the links in the tool text, then wait for "done". Kotak: after "done", call `broker_login` with `broker: kotak, step: validate`.
- `outage`: say the broker is down and do not ask for a login.
- Never write a login URL yourself.

## 2. Pull
Call `refresh`. If an IBKR connector is available, call its `get_account_summary` (primary), then `get_account_positions`, and pass them to `ingest` with `broker: "ibkr"`, `currency: "USD"`, and `fx_rate` + `fx_source` (a dated USD/INR rate; say where it came from). If summary fails, ingest positions and say the cash figure is last known.
For a broker with no connection, "import my holdings": ask for a CSV export and call `ingest` with `csv_path`.

## 3. Macro (morning and mid-day only)
Search: US close, Asian session, GIFT Nifty or Nifty, Brent, USD/INR, today's India events. Before using any level, confirm its date is today's date; otherwise label it "not same-day" and keep it out of the verdict. Give setups and levels, never direction calls.
Also search held stock symbols for upcoming bonus, split or demerger ex-dates. If any, run the `gtt` skill's audit with `corporate_actions` (mark unconfirmed dates as `confirmed: false`).

## 4. Report
1. One-line verdict that agrees with every number shown (re-read before sending; the weaker of global and domestic wins).
2. The `refresh` text: broker lines, needs attention, changes since last snapshot, brokers, positions, allocation.
3. Macro table (morning) and any corporate-action GTT risk.
4. Close (EOD): add `gtt_audit` summary line.
SIP status is not readable from any broker: ask, don't infer.

## 5. Log
Call `log_append` with a 3-5 line entry (what was pulled, totals, what changed, anything flagged). Rewrite `start_here` only when goals, next actions or decisions owed change. Never edit a verdict; log the contradiction.

## Scheduled run (investor away)
Do not wait for logins. Run `broker_status` once, then `check` (last snapshot, clearly dated) and the macro read, then one line per broker that needs login. Nothing is presented as live unless the tool says live.
