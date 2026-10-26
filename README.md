# portfolio-copilot

> **Disclaimer**: This plugin provides portfolio analysis and information, NOT investment advice. It is not SEBI-registered. It never suggests which stocks to buy; it analyzes what you hold or explicitly ask about. All decisions and orders are yours. See [DISCLAIMER.md](DISCLAIMER.md).

An analysis-and-drafting copilot for DIY Indian investors. It connects to your brokers, tells you in plain language what needs attention, audits your GTT stop-losses against your own policy, and drafts GTT plans and baskets. You decide and you execute.

**You stay in control**: every order is first a draft. In the full edition it runs only after you click "Yes, place <code>" in an inline question that lists that exact draft (enforced by code in hooks, not by the model's judgment). The lite edition cannot place orders at all.

Why it exists and how it was built: [How I Manage My Stock Portfolio in 5 Minutes a Day With AI](https://arunendapally.com/posts/portfolio-copilot-claude-plugin/).

## Install

In Claude Code or Claude Cowork:

```
/plugin marketplace add arunendapally/portfolio-copilot
/plugin install portfolio-copilot@portfolio-copilot-marketplace
```

Drafts-only edition: `/plugin install portfolio-copilot-lite@portfolio-copilot-marketplace`.

Or download [`portfolio-copilot.plugin`](https://github.com/arunendapally/portfolio-copilot/raw/main/portfolio-copilot.plugin) (or [`-lite`](https://github.com/arunendapally/portfolio-copilot/raw/main/portfolio-copilot-lite.plugin)) and open it in the Claude desktop app. Needs Node 18 or later.

Then say **"get started"** in a new chat.

## What you can say

| Say | Get |
|---|---|
| "get started" | Profile setup (or import your existing notes), broker connection, first check |
| "check my portfolio" / "daily briefing" / "EOD analysis" | All brokers in one book: totals, cash vs buffer, alerts, trades that contradict your rules, what changed since last time, allocation drift |
| "audit my GTTs" | Per-symbol quantity gaps, policy violations, crash test at -10%/-20%, corporate-action risk; then a GTT plan to approve |
| "risk check" / "review my MFs" / "basket for ₹1L" | Concentration with its base, rate sensitivity, fund screen, basket rows to enter |
| "crash mode" | Which stops fire, which would force-sell names you keep, which stage of your own deployment plan is reached |
| "analyze <stock>" | Sourced fundamentals for a stock you hold or name |

## How it works

```
Hosted broker MCPs (Kite, Kotak Neo)   one connection each, owned by portfolio-core
              │ raw payloads stay here
portfolio-core (bundled, Node, zero deps)   normalize · snapshot · audit · policy · drafts
              │ small, pre-computed results
Skills (6, thin)                       when to run what, what to show, what to ask
```

- **Numbers come from code.** The model never parses broker payloads or does portfolio arithmetic, so the same data gives the same answer every time.
- **One login per broker per day.** portfolio-core keeps its Kite session on disk, so a Claude restart does not ask you to log in again. Status is reported per broker: live, needs login, or outage.
- **Your rules, in one place.** `portfolio-copilot/profile.json` in your working folder holds your thresholds, GTT policy, where your cash buffer lives, allocation targets, staged deployment plan and per-stock verdicts. Snapshots and a small rotating log sit next to it. Broker session ids stay in `~/.portfolio-copilot/`.

### Default GTT policy (change any of it in your profile)

1. Index and commodity ETFs: target only, no stop.
2. Hold/add stocks: crash-floor stop about 25% below price, never closer than 20%.
3. EXIT/REDUCE verdicts: a single exit at the written level, no stop.
4. Every audit runs a crash test; no hold/add name should fire at -20%.
5. GTT quantity equals held quantity.

Stops protect against a broken thesis, not a market-wide fall.

## Brokers

| Broker | How |
|---|---|
| Zerodha | Live via the hosted Kite MCP, through portfolio-core |
| Kotak Neo | Live via the hosted Kotak Neo MCP, through portfolio-core (UCC + QR) |
| Interactive Brokers | Add the IBKR connector; the check skill passes its summary to portfolio-core |
| Any other | Holdings CSV: say "import my holdings" |

If you already have a standalone Kite or Kotak connector, keep it or remove it; portfolio-core does not depend on it, and the order gate covers its order tools too.

## Guardrails

1. **Orders only from approved drafts.**
   - A `PostToolUse` hook records an approval only from your own click ("Yes, place D7K2") in an inline question listing the draft. The approval is bound to a hash of the draft.
   - A `PreToolUse` hook blocks any order tool call on any server that does not match an approved draft, and blocks approval questions sent with their answers already filled in. Fails closed.
   - In a cloud chat linked to your PC, the PC accepts the cloud gate's approval only if you set `orders.allow_remote_approval = true`.
2. **Always-on house rules** injected at session start.
3. **No stale data presented as live**: every figure carries its time; carried data is labelled with how many runs it has gone unverified.
4. **Analysis audit**: the fundamentals-analyst output is checked for sourced numbers and no buy/sell language.

## What it does not do

It does not watch prices in the background, and Indian broker logins expire daily, so a scheduled run with you away gives the macro read and your last snapshot. GTTs at your broker are the always-on protection, which is why the GTT audit exists.

## Development

```bash
node --test tests/*.test.js
```

```bash
node scripts/build.js
```

```bash
python evals/run-evals.py
```

Specs (Spec Kit) are in [`specs/001-v05-rebuild/`](specs/001-v05-rebuild/), the architecture review in [`docs/specs/architecture-review.md`](docs/specs/architecture-review.md), evals in [`evals/README.md`](evals/README.md), and the release checklist in [`docs/release.md`](docs/release.md). `editions/lite/` is generated; do not edit it.

## License

MIT, see [LICENSE](LICENSE).
