# portfolio-copilot

> **Disclaimer**: This plugin provides portfolio analysis and information, NOT investment advice. It is not SEBI-registered. It never suggests which stocks to buy — it analyzes what you hold or explicitly ask about. All decisions and orders are yours. See [DISCLAIMER.md](DISCLAIMER.md).

Portfolio management for busy people who aren't investing experts. Connects to your Indian broker accounts, watches your portfolio, and tells you — in plain language — what needs attention and why: rebalancing, risk alerts, and stock verdicts backed by fundamental and technical analysis.

**You stay in control**: nothing is ever bought or sold without you seeing the exact order and saying yes (enforced by a built-in safety hook, not just a promise).

## Install

In Claude Code or Claude Cowork:

```
/plugin marketplace add arunendapally/portfolio-copilot
/plugin install portfolio-copilot@portfolio-copilot-marketplace
```

Or download [`portfolio-copilot.plugin`](https://github.com/arunendapally/portfolio-copilot/raw/main/portfolio-copilot.plugin) and open it in the Claude desktop app.

After installing, say **"get started"** in a new chat.

## Start here

Say **"get started"**. The plugin builds your investor profile (goals, risk comfort, monthly investment), connects your broker, and runs your first portfolio check.

## Skills

| Say | Get |
|---|---|
| "get started" | Profile setup, broker connection, first portfolio check |
| "import my holdings" | Use ANY broker without an MCP - upload a holdings export or CAS statement |
| "daily briefing" | 5-minute morning readout: markets, your P&L, alerts, one-line verdict |
| "open session" / "portfolio check" | Full multi-broker snapshot with coverage gaps |
| "audit GTTs" | Stop-loss order health check — finds unprotected positions and orphan orders |
| "review my MFs" | Mutual fund check vs a model portfolio for your risk profile |
| "risk check" / "weekly risk update" | Cash buffer, concentration, drawdown, beta/VaR, returns vs target |
| "monthly rebalance" | Drift analysis + specific trades to get back to target |
| "quarterly review" | What worked, what didn't, positioning for next quarter |
| "EOD analysis" | End-of-day close-out and tomorrow's setup |
| "crash mode" | Calm, staged playbook when markets fall sharply |
| "analyze <stock>" | Fundamentals + technicals assessment with reference levels — for stocks you hold or name |

## Suggested cadence

| When | Say | Time needed |
|---|---|---|
| Every morning ~9:15 | "daily briefing" | 5 min |
| Every close ~3:30 | "EOD analysis" | 5 min |
| Friday afternoon | "weekly risk update" | 10 min |
| 1st Friday monthly | "monthly rebalance" | 20 min |
| Every quarter | "quarterly review" | 30 min |

These can also run automatically: in Claude Cowork, say "run my daily briefing every weekday at 9:15 AM" and it becomes a scheduled task — your portfolio gets checked whether you remember or not. Long-term portfolios sprawl past 20 holdings (yearly buys, IPO allotments, old SIPs); scheduled monitoring is how they stay safe without eating your time.

## Built-in guardrails

1. **No auto-trading**: every order shown in full and confirmed by you, enforced by a PreToolUse hook on all order tools
2. **No stale data**: recommendations only from live, timestamped pulls; data gaps stated plainly rather than papered over
3. **Cash buffer first**: maintains a 5–10% cash cushion before any new deployment
4. **Global macro first**: no bullish calls when overnight global markets say otherwise
5. **Setups, not forecasts**: key levels, catalysts, and scenarios — never a confident prediction of market direction
6. **Self-consistency**: every verdict is checked against the data shown with it before presenting — no bullish calls sitting next to bearish data
7. **No silent logins**: authentication always requires your action (click a link / scan a QR); sessions are never assumed
8. **No return promises**: targets are goals, not guarantees; this is decision support, not financial advice

## What this plugin does NOT do

It does not monitor your portfolio in the background — data is pulled only when you run a skill (or a scheduled task runs one for you). It cannot watch prices 24/7, catch a crash in real time, or refresh itself between sessions. For routine coverage, set up scheduled runs of "daily briefing" and "EOD analysis"; for everything else, GTT orders at your broker are the always-on protection layer — which is exactly why the gtt-audit skill exists.

## Broker support

| Your broker | How it connects |
|---|---|
| Zerodha | Live — official Kite MCP, bundled with this plugin |
| Kotak Neo | Live — official MCP, bundled with this plugin |
| INDmoney | Live — add their official MCP connector |
| Upstox, Groww, Angel One, 5paisa | Live — community MCP servers exist; add as connectors |
| ICICI Direct, HDFC Securities, or any other | Statement upload — say "import my holdings" and upload your holdings export (CSV/XLSX) or CAMS/KFintech CAS. All analysis skills work; order placement needs a live connection |

### Bundled MCP servers (`.mcp.json`)

- **Kite (Zerodha)** — `npx mcp-remote https://mcp.kite.trade/sse`. Login via browser link each session.
- **Kotak Neo** — `npx mcp-remote https://neo.kotaksecurities.com/mcp-server/mcp`. Login via your UCC + QR scan in the Kotak Neo app.

Connectors (Settings UI), `claude_desktop_config.json` entries, and this plugin's `.mcp.json` are all MCP connections underneath — keep only one copy of each server to avoid duplicate tools. Other brokers (e.g., IBKR for US stocks) can be added as separate connectors; skills use them if present.

## Customization

Your targets are set conversationally: the "get started" profile captures risk level and return target (default 10% XIRR), and any skill honors updated values ("my XIRR target is 12%"). To change hard defaults permanently, edit the thresholds table in `skills/risk-check/SKILL.md` or the model allocations in `skills/mf-review/SKILL.md` and reinstall.

Defaults: XIRR ≥10%, cash buffer 5–10%, single stock ≤15%, sector ≤30%, single fund house ≤25%.

## Components

10 skills, 1 agent (fundamentals-analyst), 1 safety hook, 2 bundled broker MCP servers.

## License

MIT — see [LICENSE](LICENSE). Contributions welcome.

## Disclaimer

This plugin provides analysis and information, not investment advice. It is not SEBI-registered. Markets carry risk; past performance does not guarantee future returns. You make all final decisions. Full text: [DISCLAIMER.md](DISCLAIMER.md).
