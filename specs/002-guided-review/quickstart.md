# Quickstart: validating 002-guided-review

Run every scenario on made-up fixtures in a temp folder. None of them touches a real broker. `pc` below means `node core/bin/pc.js`; `$F` is a temp investor folder seeded by the test helpers (`tmpEnv()` plus `writeProfile(folder, fixture('profile.json'))`).

## 0. Baseline

```bash
npm test
node scripts/build.js --check
claude plugin validate --strict .
```

All green before any scenario.

## 1. v0.7.4: the gate and capture under both tool generations (US1)

```bash
node --test tests/toolmap.test.js tests/gate-toolmap.test.js tests/capture-toolmap.test.js tests/hooks-matchers.test.js tests/no-tool-names.test.js
python evals/run-evals.py --probes T0 T1 T2
```

Manual check with the hook runner:

```bash
echo '{"tool_name":"mcp__kite__gtt","tool_input":{"mode":"place","tradingsymbol":"ALPHA"}}' | node hooks/order-gate.js
# expect: permissionDecision "deny", reason names "draft"
echo '{"tool_name":"mcp__kite__gtt","tool_input":{"mode":"list"}}' | node hooks/order-gate.js
# expect: no output (allowed)
echo '{"tool_name":"mcp__kite__frobnicate","tool_input":{}}' | node hooks/order-gate.js
# expect: deny, "does not know this kite tool"
pc doctor --folder "$F" --json '{"tools":["mcp__kite__session","mcp__kite__portfolio","mcp__kite__gtt","mcp__kite__orders"]}'
# expect: "kite: read ok, write ok (generation 2)"
```

Pass when SC-001, SC-002 and SC-012 hold.

## 2. v0.8.0: connect, state, guided review (US2, US6, US3)

Connect with a refreshable expired Kite session and Kotak needing a QR:

```bash
pc connect --folder "$F" --json '{"tools":[…from tests/fixtures/toolnames.json…]}'
# expect: next = [kite session status, kite one read, kotak get_login]; manual has exactly one Kotak item; ready false
# seed the captures from tests/fixtures/kite-gen2 and the Kotak fixtures, then:
pc connect --folder "$F" --json '{"tools":[…]}'
# expect: ready true, one line per broker, "All connected"
```

Guided review on the fixture book with one GTT quantity gap and one index fund with a stop:

```bash
pc review_start --folder "$F"
pc review_next --folder "$F"        # repeat, doing each `next` with the test helpers
pc task_decide --folder "$F" --json '{"task":"<id of the gap task>","decision":"approved","option":"do","reason":"test"}'
pc task_decide --folder "$F" --json '{"task":"<id of the ETF task>","decision":"deferred","reason":"test","defer_until":"2026-12-01"}'
pc review_next --folder "$F"        # execute: returns a draft code for the gap task only
pc review_status --folder "$F"
```

Expect: propose shows two numbered tasks, each with Why, Options and Effect; execute drafts one plan; after the simulated Yes and a fresh capture showing the new GTT quantity, verify passes; record writes the log line, two journal lines, the bundle and the Todoist ops; `review_status` shows `closed`.

State:

```bash
pc state_export --folder "$F" --out /tmp/b.json
chmod 444 "$F/portfolio-copilot/log.md" && pc log_append --folder "$F" --text x ; echo "exit $?"
# expect: exit 1, ok false
```

Evals: `python evals/run-evals.py --probes T0 T1 T2 T5`.

## 3. v0.9.0: profit lock and decisions (US4, US5)

```bash
pc profit_lock_dryrun --folder "$F" --json '{"arm_gain_pct":15,"book_gain_pct":30,"trail_pct":12}'
# numbers here are test inputs, not recommendations
pc profile_update --folder "$F" --path gtt_policy.profit_lock --value '{…all values set, enabled true…}'
pc gtt_audit --folder "$F"
# expect: gain_unprotected for the fixture stock above the arm threshold with a stop below cost
pc decisions --folder "$F"
# expect: at most five cards, priority order, "Not set:" lists every rule without a threshold
```

## 4. v1.0.0: local engine and tax (US7, US8)

Only after T081 and T082.

```bash
node --test tests/local-engine.test.js tests/export.test.js tests/lots.test.js
pc export --folder "$F" --json '{"format":"dashboard","out":"/tmp/dash"}'
# expect: positions-<date>.json and cash-<date>.json with the documented fields; null technicals without history
```

Pass when SC-005 is measured and recorded.

## What the investor checks before each release goes live

1. The order gate denies a write in a fresh chat (ask the model to place a GTT without a draft).
2. A review in a cloud chat linked to the computer ends with today's snapshot and run file on the computer.
3. Nothing in the repo diff contains real symbols, quantities, prices or names (the PR template asks).
