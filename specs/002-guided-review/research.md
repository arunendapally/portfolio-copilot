# Research: 002-guided-review

Decisions already taken, and the items the implementing session must verify first. "Observed" means seen in a live session on 11-Nov or 12-Nov-2026; anything not marked observed is unverified.

## R1. What changed in the Kite MCP (observed)

- The old tools (`login`, `get_profile`, `get_holdings`, `get_mf_holdings`, `get_gtts`, `get_margins`, `get_positions`, `get_orders`, `get_trades`, `get_order_history`, `get_order_trades`, `get_ltp`, `get_ohlc`, `get_quotes`, `get_historical_data`, `search_instruments`, `place_order`, `modify_order`, `cancel_order`, `place_gtt_order`, `modify_gtt_order`, `delete_gtt_order`) are gone from the chat. Calling one returns `unknown tool "<name>"`.
- The new tools are `session`, `portfolio`, `gtt`, `market`, `mutual_funds`, `orders`, `alerts`, `help`, `open_kite_view`, each selected by a `mode` argument. Modes are listed in [contracts/broker-tools.md](contracts/broker-tools.md).
- `session` mode `status` returns `authenticated`, `kite_session_expired`, `kite_session_expires_at`, `refresh_available`. With `kite_session_expired: true` and `refresh_available: true`, the next read succeeded with no login. There is no login tool.
- List reads return `{ data: [...], pagination: { from, limit, total, has_more, returned } }` with a default limit of 100. `mutual_funds` returns a bare array.
- `orders` write modes return an approval step of the broker's own: a form, or `approval_required` with an `approval_url` and an `approval_id` to check with mode `approval_status`.
- `portfolio` mode `holdings` has `type`: `full`, `compact` (symbol, quantity, T1 quantity only) and `summary`.

**Decision**: support both generations in the tool map. Prefer the new generation when both are present.

**To verify (T004)**: whether `gtt` mode `delete` and mode `modify` now work through the connector (the old `delete_gtt_order` failed with "trigger_id is required"). If they do, drop the Kite-web delete fallback from the gtt skill and the README. Verify on a throwaway GTT with the investor present; never in an eval.

**To verify (T005)**: how a login is started when `refresh_available` is false. Record the exact response and add it to `LOGIN_RE` or the connect flow.

## R2. Why the gate went blind (confirmed by running the code)

`hooks/hooks.json` PreToolUse matcher and `order-gate.js` `WRITE_RE` both require a name ending in `(place|modify|delete|cancel|submit)_(gtt_)?order` or `create_order_instruction`. `…__orders` and `…__gtt` match neither, so the hook does not run and `decide()` returns allow. IBKR `delete_order_instruction` is also unmatched.

**Decision**: match by broker, classify in code, deny unknown (plan section 2). Alternatives rejected: adding the two new names to the regex (same failure at the next rename); a prompt hook (Principle I says code).

## R3. Kotak Neo payloads (observed)

- `get_holdings` returns a CSV string with the header `Average Purchase Price,Shares Owned,Market Segment,Total Cost of Holdings,Market Value,Instrument Type,Current Price,Stock Ticker,Stock Name,Industry Sector,Available Quantity for Sell,Security Type,Security Subtype`. The current parser reads it.
- `get_limits` returns an array with one CSV string whose header starts `Cash Margin,Margin From Shares,Margin Used,Available Margin,…,Timestamp,Status Code,Status`. `inputs.cashFrom` returns null for it (confirmed by running the code).
- Listed instruments carry the previous session's close as "Current Price". A suspended scrip carries its average price as the price and a market value equal to cost.

**Decision**: parse limits with the delimited parser (`cash margin`, then `available margin`). Add `price_as_of` per holding. Value frozen holdings at zero once flagged (FR-042).

## R4. Where the tokens go (observed, sizes approximate)

One full pull on a book of about 40 listed holdings, 40 standing orders and a dozen funds: holdings (full) about 28 KB, standing orders about 40 KB, funds about 3 KB, Kotak about 3 KB, IBKR under 1 KB. That is roughly 25K tokens before any analysis, so the 30K budget holds only if each read happens once and the engine does all arithmetic. Sessions that re-pull or compute in context go far past it.

**Decision**: chat-only use targets one pull per run (SC-004). Anything lower needs pulls outside the model (US7). Compact holdings are not enough (no price or cost).

## R5. Guided-run design choices

- **Stages in code, not in the skill**: skills are advisory and get skipped; a run file with gates is checkable and resumable.
- **Research as submitted findings**: the engine cannot browse. Having the model submit `{symbol, metric, value, period, source_url, accessed}` and letting the engine validate and evaluate keeps numbers out of model judgment.
- **Task approval vs order approval**: two different things. Task decisions are recorded by a command the model calls after the investor answers; they authorise nothing. Orders keep the click-bound draft approval.
- **Five-task cap and fixed priority**: a daily list longer than five is not acted on; a fixed order makes runs comparable.
- **Todoist**: the engine returns a sync list (`create`, `complete`, `update` with stable external ids); the skill applies it with the Todoist tools when present. No Todoist client in the engine.

## R6. How a local engine could reach each broker (US7) — NOT decided

| Broker | Option | For | Against / unknown |
|---|---|---|---|
| Kite | A. Broker's developer API with the investor's own app key, daily login by redirect to localhost | Documented, stable field names, price history available | Terms, cost and whether a personal read-only use is allowed must be checked on the broker's site on the day; a second session beside the chat connector |
| Kite | B. The engine acts as an MCP client to the same hosted Kite MCP | No developer app; same data shapes as chat | Whether two clients can hold sessions at once is unknown; payloads are tool-shaped |
| Kotak Neo | A. Broker's trading API with TOTP login | One tap per day | Credential storage on disk; terms to check |
| Kotak Neo | B. Keep chat-only (QR) and import the captured files | No new credential | Kotak stays outside the local pull |
| IBKR | A. Flex Web Service with a read-only token, end-of-day positions and cash | No gateway process, read-only by design | End-of-day only |
| IBKR | B. Client Portal gateway | Intraday | A second process and its own login |

**Recommendation (architect)**: Kite A, Kotak B to start, IBKR A. Reasons: Kite carries the standing orders and most of the book, so it gains most; Kotak is small and read-only, so one QR in chat is acceptable; IBKR end-of-day is enough for a long-term holding.

**Blocking**: verify each broker's current terms and limits from first-party pages, record them here with the date, then get the investor's sign-off (spec, open decision 3) and merge the constitution amendment (T082) before writing a collector.

## R7. Regulation notes carried from the roadmap

API-placed orders fall under the retail algo framework in the investor's notes (vendor key, static address). The local engine therefore has no order path (FR-048). Analysis-only stays within "analysis, not advice" as long as thresholds are the investor's and no security is suggested.

## R8. Fixtures without personal data

The implementing session must not copy payloads from the investor's sessions. Build fixtures from the field lists in [contracts/broker-tools.md](contracts/broker-tools.md) with made-up symbols (`ALPHA`, `BETA`, `GAMMAETF`), quantities and prices, as the existing `tests/fixtures/kite-book.json` does.
