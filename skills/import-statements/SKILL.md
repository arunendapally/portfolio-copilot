---
name: import-statements
description: Import portfolio data from files when the user's broker has no MCP connection. Use when the user says "import my holdings", "upload my portfolio", "I use ICICI Direct / Groww / HDFC Securities / Angel One" (or any broker without a connected MCP), or uploads a holdings file, tradebook, P&L export, or consolidated account statement (CAS). Parses the files into a session portfolio snapshot that all analysis skills can use.
---

# Import Statements

Let users of ANY broker use the analysis skills — no MCP required. Parse uploaded files into a standard portfolio snapshot.

## Accepted files

1. **Holdings export** (CSV/XLSX): every major broker offers this — ICICI Direct portfolio page, Groww "Download holdings", Angel One, HDFC Securities, Upstox, 5paisa, Zerodha Console. Columns vary; map flexibly (symbol/ISIN, quantity, average price, current value).
2. **Tradebook / order history** (CSV/XLSX): enables XIRR from actual cash flows.
3. **Consolidated Account Statement (CAS)** from CAMS or KFintech (PDF, often password-protected — ask for the password, typically PAN): covers ALL mutual funds across every platform. This is the best single source for MF analysis.
4. **MF holdings export** from any app (CSV/XLSX/PDF).

## Parsing rules

1. Detect broker/format from headers; never assume column order. Show the user a 3-row preview of the parsed result and confirm before analyzing.
2. Extract per row: symbol or ISIN, name, quantity, average cost, and (if present) current price and value.
3. If current prices are missing or the file is dated, fetch live quotes via web search or any connected market-data MCP; otherwise state clearly that valuations are as of the file date.
4. Record an **as-of date** for the snapshot (file export date if shown, else ask). Every subsequent output must display it: "based on your holdings as of <date>".
5. Merge multiple files (e.g., ICICI Direct equity CSV + CAMS CAS) into one consolidated snapshot; dedupe MFs by ISIN/folio.

## What works in import mode

All analysis skills: risk-check, mf-review, macro-brief, daily-briefing (briefing mode), crash-protocol (triage against user-stated stop levels), and the fundamentals-analyst agent.

## What does NOT work in import mode

Anything requiring a live broker connection: GTT audit/placement, order drafting, live margins, real-time P&L. State this once, plainly: "I can analyze everything from your files; placing or checking orders needs a broker connection or your broker's own app."

## Rules

- Staleness discipline: snapshots older than 7 days get a visible warning on every risk output; suggest a fresh export.
- Privacy: never echo account numbers, PAN, or folio numbers back into outputs; use scheme/stock names only.
- Remind the user they can re-import anytime with a fresh export; offer to remember their broker and format for next time.
