# Contract: broker tool map

Source of truth: `core/lib/brokers/toolmap.js`. No other source file may contain a broker tool name (enforced by a test that greps `core/`, `hooks/` and `skills/` source for the names below).

Broker is taken from the server segment of the tool name; tool is the text after the last `__`. Examples: `mcp__kite__gtt`, `mcp__remote-devices__kite__gtt`, `mcp__Interactive_Brokers_IBKR__get_account_positions`.

## Kite, generation 2 (observed 12-Nov-2026)

| Tool | Mode | Kind | Capability | Key arguments |
|---|---|---|---|---|
| `session` | `status` | session | session | none |
| `session` | `logout` | session | session | none |
| `portfolio` | `profile` | read | profile | |
| `portfolio` | `margins` | read | margins | |
| `portfolio` | `holdings` | read | holdings | `type` must be `full` to count; `compact` and `summary` are not captured as holdings |
| `portfolio` | `positions` | read | positions | rows carry `view` = `day` or `net`; never sum the two |
| `mutual_funds` | `holdings` | read | mf | returns a bare array |
| `gtt` | `list` | read | gtts | `from`, `limit` |
| `gtt` | `place` | write | gtt_write | `exchange, tradingsymbol, last_price, transaction_type, product, trigger_type` and either `trigger_value, quantity, limit_price` or `lower_trigger_value, lower_quantity, lower_limit_price, upper_trigger_value, upper_quantity, upper_limit_price` |
| `gtt` | `modify` | write | gtt_write | `trigger_id` plus the place fields |
| `gtt` | `delete` | write | gtt_write | `trigger_id` |
| `orders` | `list` | read | orders | |
| `orders` | `all_trades` | read | trades | |
| `orders` | `history`, `trades` | read | order_detail | `order_id` |
| `orders` | `approval_status` | read | order_approval | `approval_id` |
| `orders` | `place` | write | order_write | `variety, exchange, tradingsymbol, transaction_type, quantity, product, order_type, price` |
| `orders` | `modify`, `cancel` | write | order_write | `order_id`, `variety` |
| `orders` | `permissions` | write | order_write | treated as a write: it can grant standing permission for future orders |
| `market` | `ltp` | read | ltp | `instruments` |
| `market` | `quote`, `ohlc`, `search`, `option_chain` | read | market | |
| `market` | `historical` | read | history | `instrument_token, from_date, to_date, interval` |
| `alerts` | any | read | other | not order-capable; passes the gate |
| `help`, `open_kite_view` | any | read | other | |

A call to `gtt`, `orders` or `portfolio` with no `mode`, or with a mode not in this table, is `unknown` and is denied.

List response shape: `{ "data": [ … ], "pagination": { "from": 0, "limit": 100, "total": 36, "has_more": false, "returned": 36 } }`. Holdings rows (full): `tradingsymbol, exchange, instrument_token, isin, product, quantity, t1_quantity, average_price, last_price, close_price, pnl, day_change, day_change_percentage`. GTT rows: `id, type (single|two-leg), status, created_at, condition { exchange, tradingsymbol, last_price, trigger_values[] }, orders[] { transaction_type, quantity, price, product, order_type }, meta { rejection_reason }`. Margins: `{ equity: { net, available { cash, live_balance, opening_balance } } }`. Funds rows: `folio, fund, tradingsymbol (ISIN), average_price, last_price, last_price_date, quantity`. LTP: `{ data: { "NSE:ALPHA": { instrument_token, last_price } }, meta: { missing_instruments[] } }`. Session status: `{ authenticated, kite_session_expired, kite_session_expires_at, refresh_available, status }`.

## Kite, generation 1 (until 11-Nov-2026)

| Tool | Kind | Capability |
|---|---|---|
| `login` | session | session |
| `get_profile` | read | profile |
| `get_holdings` | read | holdings |
| `get_mf_holdings` | read | mf |
| `get_gtts` | read | gtts |
| `get_margins` | read | margins |
| `get_positions` | read | positions |
| `get_orders` | read | orders |
| `get_trades` | read | trades |
| `get_order_history`, `get_order_trades` | read | order_detail |
| `get_ltp` | read | ltp |
| `get_ohlc`, `get_quotes`, `search_instruments` | read | market |
| `get_historical_data` | read | history |
| `place_gtt_order`, `modify_gtt_order`, `delete_gtt_order` | write | gtt_write |
| `place_order`, `modify_order`, `cancel_order` | write | order_write |

## Kotak Neo (read-only broker)

| Tool | Kind | Capability |
|---|---|---|
| `get_login`, `validate_login`, `get_logout` | session | session |
| `get_holdings` | read | holdings |
| `get_limits` | read | margins |
| `get_margin` | read | other |
| `get_positions` | read | positions |
| `get_order_book`, `get_order_history`, `get_trade_book` | read | orders |
| `get_quote`, `get_research`, `search_instrument` | read | market |

Reads need the `sessionid` from `get_login`. Unknown Kotak tools pass the gate and are logged, because the broker has no order tool in this connector. If an order-shaped tool ever appears (name contains `order` with `place|modify|cancel`), it is `unknown-write` and denied.

## Interactive Brokers

| Tool | Kind | Capability |
|---|---|---|
| `get_account_positions` | read | holdings |
| `get_account_balances`, `get_account_summary` | read | margins |
| `get_account_orders`, `get_account_trades`, `get_order_instructions` | read | orders |
| `create_order_instruction`, `delete_order_instruction` | write | order_write |
| `create_alert`, `update_alert`, `delete_alert`, `set_alert_status`, watchlist and screener tools | read | other (no order effect; pass) |
| every other `get_*`, `search_*`, `list_*`, `preview_*`, `run_*`, `whats_new` | read | market |

## Functions

```js
resolve(toolName, toolInput)
// -> { broker, tool, mode, kind: 'read'|'write'|'session'|'unknown', cap, order_capable: bool }

readCalls(broker, present)
// -> [{ tool, args, cap, required: bool }]   the calls connect/pull should make, newest generation present

writeCall(broker, cap, op, args, present)
// op: 'place'|'modify'|'delete'|'cancel'
// -> { tool, args }   e.g. kite gen 2: { tool: 'gtt', args: { mode: 'place', ...args } }
//                          kite gen 1: { tool: 'place_gtt_order', args }

doctor(present, profile)
// -> [{ broker, enabled, read_path: bool, write_path: bool, unknown: [toolNames], generation }]
```

`present` empty or missing means "assume the newest generation".

## Tests that must exist

- Every row above resolves to its kind and capability, with at least two different prefixes.
- Every write row is denied by the gate with no draft, and allowed exactly once with a matching approved row.
- `gtt` and `orders` with a missing or unlisted mode are denied.
- A made-up tool on Kite or IBKR is denied; on Kotak it passes unless it looks like an order write.
- The grep test: no tool name from this file appears outside `toolmap.js`, its tests, fixtures and generated skill text.
