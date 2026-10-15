# Draft issue for zerodha/kite-mcp-server

> Status: draft, not posted. Arun posts it. Checked 15-Oct-2026 against `main` @ 5e044dc
> (10-Jul-2026); no existing issue found on 14-Oct.
>
> Read before posting: in `mcp/common.go`, `ValidateRequired` returns "is required" only when
> `args["trigger_id"]` is **nil**. A wrong type (string, float) passes that check. So the server
> is reporting that the argument never arrived. That points at the client path (Claude connector
> or proxy dropping the argument) as much as at the server. The ask below is phrased to find out
> which. If a direct curl with a logged-in session works, close this as client-side and record it
> in `feedback.md` instead.

---

**Title:** Hosted mcp.kite.trade: `delete_gtt_order` / `modify_gtt_order` return "parameter 'trigger_id': is required" with a numeric id

**What happens**

Since about 30-Sep-2026, on the hosted server (`https://mcp.kite.trade/mcp`), with a logged-in
session:

- `delete_gtt_order` with `{"trigger_id": <numeric GTT id from get_gtts>}` returns
  `parameter 'trigger_id': is required`.
- `modify_gtt_order` with a numeric `trigger_id` and the other required fields returns the same
  error.
- `place_gtt_order` and `get_gtts` work in the same session.

**What we checked**

Unauthenticated calls, same tool:

| `trigger_id` sent | Response |
|---|---|
| `1` (number) | "Please log in first" (validation passed) |
| `"1"` (string) | "Failed to delete GTT order" |
| `1.0` | "Failed to delete GTT order" |

Reading `mcp/post_tools.go` and `mcp/common.go`: "is required" comes from `ValidateRequired`,
which fires only when the key is missing or nil. A numeric value should pass it, as the
unauthenticated call with `1` shows.

**Questions**

1. Does the hosted server disable `delete_gtt_order` / `modify_gtt_order` on purpose? The README
   says "The hosted version at `mcp.kite.trade` excludes potentially destructive trading
   operations", but both tools are still listed and reachable.
2. If they are meant to work: is there any path on the hosted server (a gateway, or a schema
   rewrite) that could drop `trigger_id` from the arguments of an authenticated call?
3. If they are disabled on purpose, could they return a clear "not available on the hosted
   server" message, or be left out of `tools/list`, so clients don't retry?

**Environment**

- Client: Claude (claude.ai connector and Claude Code), Streamable HTTP.
- GTT ids are integers, as returned by `get_gtts`.

**Workaround in use**

Place the new GTT through MCP first, then delete the old one in Kite web, then check with
`get_gtts`.
