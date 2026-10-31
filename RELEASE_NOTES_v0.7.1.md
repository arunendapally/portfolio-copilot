Covers 0.7.0 and 0.7.1. **Upload `portfolio-copilot.plugin` below to claude.ai and start a new chat.** Remove any older or lite copy first.

## Breaking (0.7.0)
- `portfolio-core` (the MCP server), its Kite and Kotak clients, `broker_login` and `execute_draft` are gone. Tools are now commands of the plain script `pc.js`, and broker reads and orders go through the brokers' own MCPs.
- `orders.allow_remote_approval` is removed.
- The order gate matches broker write tools by name suffix and allows each approved draft row once.

## Fixed (0.7.1, #25)
- IBKR ingest reads `contract_description` as the symbol and refuses rows with no symbol, instead of merging them into `UNDEFINED`.
- Documented the stage, run, write-back flow for cloud chats linked to the PC.
- A rejected GitHub token in `report_gap` is explained, and the chat files gaps through the GitHub MCP.

## Checks
- CI is green on Ubuntu and Windows, Node 18 and 22.
- `claude plugin validate --strict` passes for both editions.

Not investment advice.
