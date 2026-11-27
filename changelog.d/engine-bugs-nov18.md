### Fixed
- `broker_status` takes `tools` (the broker tool names the chat can see) and no longer reports Kite as "not connected" before the first read when only the grouped Kite tools (session, portfolio, gtt, market, orders) are present; it asks for the Kite session check instead.
- `ingest` takes IBKR rows under `positions` as well as `holdings`, and refuses rows under any other key or a cash value that is not a number, instead of ingesting 0 rows or saving cash as null. It says when no cash was given.
- `export --format dashboard` writes broker, type, kind and bucket as the dashboard labels them (Kite, Equity, Stock, India equity) and `asof` as IST text. `prevClose` for Kite holdings is Kite's own previous close, not the last snapshot's price.
