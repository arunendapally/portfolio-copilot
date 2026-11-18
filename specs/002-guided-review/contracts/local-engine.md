# Contract: local engine (US7)

**Status**: unblocked 18-Nov-2026: research R6 decided (Kite free Personal API, Kotak in chat, IBKR Flex), constitution 2.0.0 amends Principle IV. `portfolio_status` also takes an optional `login` ({ broker, request_token }) so the daily Kite login can finish from chat.

## Process

One Node process on the investor's computer: `node local/server.js --folder <investor folder>`. It is a stdio MCP server registered in the investor's Claude desktop config, so it reaches cloud chats through the desktop link like any local server. It holds no order capability.

```text
local/
├── server.js       # MCP stdio server: 4 tools below; calls core/tools.js callTool
├── collect.js      # runs collectors on demand and once per trading day after login
├── collectors/
│   ├── index.js    # interface below
│   ├── kite.js
│   ├── kotak.js
│   └── ibkr.js
├── export.js       # wraps the `export` command
└── technicals.js   # daily closes -> dma50, dma200, rsi14, sup20, hi52, dated
```

`local/` is excluded from the lite edition by `scripts/build.js`.

## Collector interface

```js
module.exports = {
  broker: 'kite',
  status(): Promise<{ state: 'ready'|'needs_login'|'error', detail, login?: { url?, steps[] } }>,
  login(input?): Promise<{ state, detail }>,           // the one manual step per day, if any
  pull(caps: string[]): Promise<{ written: string[], partial: string[], errors: [] }>,
  history?(symbols: string[], days: number): Promise<{ written: string[] }>,
};
```

`pull` writes the same `~/.portfolio-copilot/captured/<broker>/<cap>.json` records the capture hook writes (contracts/hooks.md), with `tool` set to `local:<broker>:<endpoint>`. Everything downstream is unchanged. A collector never writes into the investor folder.

Secrets (tokens, keys) live in `~/.portfolio-copilot/secrets/<broker>.json`, mode 0600 where the OS supports it, never in the investor folder or the repo, never in tool results or logs. A collector that needs a secret it does not have returns `needs_login` with steps.

## MCP tools exposed to the model

All results are summaries; each response is under 2 KB of text. No raw payload is returned.

| Tool | Input | Result |
|---|---|---|
| `portfolio_status` | none | per broker: state, data time; `All connected` line or the manual steps |
| `portfolio_refresh` | `brokers?` | runs collectors now, then `refresh`; returns the check summary text |
| `portfolio_review` | `action`: `start | next | status | decide | done | research`, plus that action's arguments | the `review_*` / `task_*` / `research_submit` result `text` and `next` |
| `portfolio_query` | `q`: `holding <SYM> | allocation | guardrails | gtt <SYM> | journal | decisions | export` | the matching engine text |

`next` steps of kind `call` that name broker read tools are executed by the server itself when a collector covers that capability, so the model only sees steps it must do (ask, manual, research, todoist, files). Broker write steps (from approved drafts) are passed through to the model unchanged: execution stays in chat behind the order gate, or with the investor.

## Scheduling

`collect.js --daily HH:MM` pulls once per trading day at the given time if every collector is `ready`, and writes a snapshot. When a login is needed it records the need and does nothing else; the next `portfolio_status` reports it. No background retries beyond one per hour.

## Fallback

When the local server is not reachable, the `check` skill behaves as in v0.8 (broker tools in chat). The skill decides by calling `portfolio_status` first and falling back on any error.

## Tests (`tests/local-engine.test.js`)

- A fake collector writing fixture captures leads to the same snapshot as the hook path.
- No local tool result exceeds 2 KB on a 100-holding fixture.
- No tool named in the broker tool map as `write` is callable through the local server.
- A collector without secrets reports `needs_login` and writes nothing.
- The lite build contains no `local/` files.
