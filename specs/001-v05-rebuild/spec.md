# Feature Specification: portfolio-copilot v0.5 rebuild

**Feature Branch**: `001-v05-rebuild`

**Created**: 2026-10-14

**Status**: Draft

**Input**: User description: "Implement all the changes in the new version: field feedback (feedback.md, Jul-Oct 2026) plus the architecture review (docs/specs/architecture-review.md). It should be simple, integrated and fast."

Sources: [feedback.md roadmap and dated entries](../../docs/specs/v0.5.md), [architecture review](../../docs/specs/architecture-review.md), constitution v1.0.0.

## User Scenarios & Testing *(mandatory)*

Actors: **Investor** (a busy DIY Indian retail investor with one or more broker accounts), **Maintainer** (ships the plugin).

### User Story 1 - Connect once, know what is live (Priority: P1)

The investor starts a session. The plugin checks each broker separately, says which are live, which need a login and which are down, and gives a login link only for the ones that need it. After logging in once per broker, the session stays usable for the whole working session.

**Why this priority**: every other story depends on live data. Login friction and false "log in again" prompts are the largest recurring cost in the field log (Jul-Oct, 15+ entries).

**Independent Test**: with one broker logged in and one expired, start a session; the output names the live broker as live and gives exactly one link, for the expired broker. Leave the session idle 15 minutes; a holdings pull still succeeds without a new login.

**Acceptance Scenarios**:

1. **Given** Broker A is logged in and Broker B is expired, **When** a session starts, **Then** the status shows A live and B needs login, and only B's link appears.
2. **Given** a broker's first request after start times out, **When** the plugin retries once, **Then** a success is reported normally with no error shown to the investor.
3. **Given** the investor just completed a login and the broker then returns a server failure, **When** the plugin reports status, **Then** it says "broker outage", does not ask for another login, and marks any checks that needed that broker as "unverified, outage" with a count of consecutive unverified runs.
4. **Given** the investor already has their own connector for a broker, **When** the plugin runs, **Then** it uses that connector and does not ask for a second login to the same broker.
5. **Given** any login link is shown, **Then** it is exactly a link the broker's login step returned in this session, never one the plugin built itself.

---

### User Story 2 - Fast, consistent daily check (Priority: P1)

The investor asks for a daily check (morning, mid-day or close). In under a minute they get: one-line verdict, consolidated holdings across all brokers (equity, ETFs, mutual funds, foreign accounts converted to INR with the rate stated), cash position, items needing attention, and any trade that contradicts their own rules.

**Why this priority**: this is the daily habit the product lives on. Today it is slow, reads hundreds of KB of notes, and gives different numbers for the same data.

**Independent Test**: run the check twice on the same broker data; every number is identical, the response arrives in under 60 seconds after login, and every figure carries a time and, for percentages, its base.

**Acceptance Scenarios**:

1. **Given** holdings changed since the last check with no trade visible today, **When** the check runs, **Then** it lists each added, removed or changed position since the last snapshot and says whether a standing order (GTT) or a manual trade explains it, where the broker tells it.
2. **Given** the investor's profile marks a symbol "hold, do not add" and today's orders include a buy of it, **When** the check runs, **Then** the contradiction is shown unprompted at the top.
3. **Given** a broker reports a small negative available margin on a cash account with no positions, **Then** it is shown as zero, not as a margin call.
4. **Given** mutual-fund SIP status cannot be read from any connected broker, **Then** the check says it is unknown rather than inferring an amount.
5. **Given** the check runs on schedule while the investor is away and broker logins have expired, **Then** it delivers the macro read and the last snapshot (dated as such), one per-broker login message, and nothing presented as live.

---

### User Story 3 - GTT audit that follows the investor's policy (Priority: P1)

The investor asks for a GTT (standing order) audit. The plugin compares every holding to its standing orders under the investor's GTT policy and returns a short table of gaps, policy violations and a crash test, then drafts the fixes.

**Why this priority**: the current audit contradicts the investor's policy (it pushes tight stops that force-sold good holdings in Aug-Sep 2026) and misses quantity gaps that a per-symbol check finds every time.

**Independent Test**: on a recorded book of 40+ holdings, the audit returns per-symbol quantity gaps, policy violations and the crash test; repeated runs give identical output; the full response fits in a few screens.

**Acceptance Scenarios**:

1. **Given** a holding of 117 units with a standing order for 108, **Then** the audit reports a 9-unit gap with its value; **Given** an order for more units than held, **Then** it reports the excess.
2. **Given** default policy, **When** an index or commodity ETF has a stop-loss, **Then** it is flagged ("ETFs: target only, no stop"); **When** a hold/add stock's stop sits closer than 20% below price, **Then** it is flagged with a proposed crash-floor level about 25% below; **When** a symbol is marked EXIT/REDUCE, **Then** a single exit at the written level is expected and no stop.
3. **Given** the investor's profile overrides a policy threshold, **Then** the override is used and named in the output.
4. **Given** any audit, **Then** it includes a crash test listing which stops fire at a uniform -10% and -20% move, and flags any hold/add name that fires at -20%.
5. **Given** a held symbol has an upcoming bonus, split or demerger, **Then** the audit re-scores the affected standing orders against the adjusted price, or marks the date "unconfirmed" if no reliable source confirms it.
6. **Given** fixes are needed, **Then** the plugin drafts a change plan that places new orders first and lists the exact old order IDs to remove afterwards, so no holding is ever left unprotected.

---

### User Story 4 - Orders only from approved drafts (Priority: P1)

Whatever the plugin proposes (GTT changes, basket buys) is first a draft the investor can read. In the full edition the plugin may submit an order only if it matches, field for field, a draft the investor approved. In the lite edition it never submits; the investor executes in the broker app.

**Why this priority**: real money. On 30-Sep the plugin's protection did not load at all and 33 orders went through on conversation judgment alone.

**Independent Test**: against a simulated broker, an order call that matches an approved draft is allowed; one that differs in any field, or has no approved draft, is blocked, with no reliance on the model's judgment.

**Acceptance Scenarios**:

1. **Given** an approved draft for 100 units at trigger 250, **When** an order for 100 at 250 is submitted, **Then** it proceeds; **When** 110 at 250 is submitted, **Then** it is blocked and the investor sees why.
2. **Given** the investor said "yes" before seeing the order details, **Then** no draft is approved and orders are blocked.
3. **Given** the lite edition, **Then** no order can be submitted by the plugin and every action ends at a draft.
4. **Given** the broker's own delete/modify operation fails, **Then** the plan tells the investor exactly which order IDs to delete in the broker app and verifies afterwards.

---

### User Story 5 - Basket draft ready to enter (Priority: P2)

For a planned purchase (for example a war-chest tranche), the investor asks for a basket. The plugin outputs the exact rows (symbol, exchange, quantity, LIMIT price, basis), the total, and the cash check, ordered for quick entry in the broker's basket screen, with an optional import file.

**Why this priority**: removes the arithmetic step from a task the investor does by hand today (about 40 clicks for 11 rows).

**Independent Test**: given target amounts per instrument and live prices, the plugin produces rows whose quantities times prices sum to within one share of each target and never exceed available cash.

**Acceptance Scenarios**:

1. **Given** a tranche amount and the investor's saved destination split, **Then** rows are computed per instrument with LIMIT slightly above last price, and the total and remaining cash are shown.
2. **Given** a destination contradicts a standing verdict or the cash rule in the profile, **Then** the draft flags it before showing rows.

---

### User Story 6 - Calm crash mode using the investor's own plan (Priority: P2)

When the market falls sharply, the investor asks for crash mode. The plugin shows which stops would fire, classifies the fall with sources, and, only if the investor has a written staged deployment plan, says which stage the current index level reaches and drafts that stage's basket.

**Why this priority**: the current crash mode invents tranches and proposes tightening stops in a fall, which contradicts the investor's policy.

**Independent Test**: with a saved staged plan and an index level past stage 1, crash mode reports stage 1 reached and drafts its basket; with no saved plan, it drafts nothing and asks.

**Acceptance Scenarios**:

1. **Given** a hold/add stock's stop would fire in the current fall, **Then** crash mode proposes widening it to crash-floor, never tightening.
2. **Given** the cash buffer is held outside the broker per the profile, **Then** broker cash counts as deployable and is not blocked by the buffer rule.

---

### User Story 7 - Set up once, carry my rules everywhere (Priority: P2)

A new investor says "get started"; the plugin captures goals, risk comfort, thresholds, where their cash buffer is held, allocation targets, GTT policy choices, staged deployment plan and per-symbol verdicts, and creates their state folder. An existing investor (the original user) can import their current notes into the same structure once, confirming each item.

**Why this priority**: today the real rules live in one person's private notes, so a second user gets outdated defaults; and session start reads 300 KB of notes.

**Independent Test**: complete onboarding in a fresh folder; the state folder exists with a valid profile, an empty log with a "Start here" block, and no other files; the next daily check reads under 20 KB of state.

**Acceptance Scenarios**:

1. **Given** an existing investor's notes, **When** they run the import, **Then** each extracted rule and verdict is shown for confirmation before it is saved, and nothing numeric that is a snapshot (quantity, price, P&L) is imported as a rule.
2. **Given** the log grows past one month, **Then** older entries move to a monthly archive and session start still reads only the "Start here" block and the current month.
3. **Given** the investor updates a threshold in conversation, **Then** the profile changes and every later check uses it.

---

### User Story 8 - Stock analysis that shows its sources (Priority: P3)

The investor asks "analyze <stock>" for a stock they hold or name. They get a structured assessment where every number has a source quote and data period, a Sources list with links, and no buy/sell instruction.

**Why this priority**: valued but not daily; currently broken (the analysis step never runs in tests).

**Independent Test**: ask for an analysis of a named stock; the output contains a Sources section with links, every figure is quoted with its period or marked "not found in sources", and a compliance check ran on it.

**Acceptance Scenarios**:

1. **Given** a stock with sparse public data, **Then** the analysis stops after a bounded search and says what was not found.
2. **Given** the investor asks "what should I buy", **Then** the plugin explains it analyzes their choices and offers to analyze a name they pick.

---

### User Story 9 - Maintainer ships with confidence (Priority: P2)

The maintainer opens a change. Automated checks confirm the plugin validates, the order protection matches every known tool naming form, the computation is correct on recorded data, and no instruction contradicts the GTT policy. Before a release, behavioural tests confirm the plugin loads, the house rules are active, the order protection blocks, and analysis is sourced.

**Why this priority**: a broken release (v0.4.0) silently disabled every safeguard for six weeks.

**Independent Test**: introduce a deliberately malformed hooks file in a branch; checks fail before merge.

**Acceptance Scenarios**:

1. **Given** a change that breaks plugin loading, **Then** automated checks fail.
2. **Given** a release candidate, **Then** both editions are built from one source and each passes its tests before upload.

---

### Edge Cases

- A broker returns a partial list (for example 11 of 12 fund folios): the check compares folio count with the last snapshot and flags a drop without concluding it was a sale.
- A foreign account's summary and balance endpoints disagree or one fails: summary is primary; if both fail, value is estimated from positions plus last known cash and labelled.
- A web search returns a date or level that conflicts with the session date: the field is shown as low-confidence and not used in a verdict.
- A symbol has two standing orders that together cover more units than held: flagged as double coverage.
- Holdings exceed 100 symbols or 100 standing orders: performance budgets still hold.
- The investor's notes contain a percentage measured on a different base than the rule: the plugin shows both bases rather than comparing them.
- The plugin is installed in an environment where its safeguards cannot load: the house rules and order rule are still delivered through a fallback path, and the first response says protection is degraded.

## Requirements *(mandatory)*

### Functional Requirements

**Connectivity**
- **FR-001**: The plugin MUST check each connected broker independently at session start and report each as live, needs login, or outage.
- **FR-002**: The plugin MUST show login links only for brokers that need login, and only links returned by that broker's login step in the current session.
- **FR-003**: The plugin MUST retry a broker's first request once on timeout before reporting a failure.
- **FR-004**: The plugin MUST distinguish "needs login" from "outage after login" and MUST NOT ask for re-login during an outage.
- **FR-005**: The plugin MUST use one connection per broker, reusing an existing investor-installed connector when present.
- **FR-006**: A broker session MUST remain usable for at least 15 idle minutes after login, within the broker's own daily expiry.
- **FR-007**: Checks that could not run because of an outage MUST be carried forward as "unverified" with a running count of consecutive unverified runs.

**Computation and consistency**
- **FR-008**: All figures (quantities, values, P&L, weights, gaps, crash tests) MUST be computed deterministically by the plugin from broker data, with identical output for identical input.
- **FR-009**: Every figure MUST carry a timestamp; every percentage MUST name its base.
- **FR-010**: The plugin MUST consolidate equity, ETFs, mutual funds and foreign accounts across all connected brokers, stating any currency conversion rate used.
- **FR-011**: The plugin MUST save a per-symbol snapshot each run and report differences against the previous snapshot.
- **FR-012**: The plugin MUST compare today's orders and trades and snapshot differences against the investor's verdicts, cash rule and concentration limits, and surface contradictions unprompted.
- **FR-013**: The plugin MUST state explicitly when information is not available from any connector (for example SIP status) instead of inferring it.
- **FR-014**: Small negative available margin on a cash account with no positions MUST be treated as zero.

**GTT policy and audit**
- **FR-015**: The GTT policy MUST be defined once with defaults (ETFs: target only; hold/add stocks: crash-floor stop about 25% below, never closer than 20%; EXIT/REDUCE: single exit at written level, no stop; no verdict means hold) and be overridable in the investor's profile.
- **FR-016**: Every GTT audit MUST compare standing-order quantity to held quantity per symbol, in both directions.
- **FR-017**: Every GTT audit MUST include a crash test at -10% and -20%.
- **FR-018**: Every GTT audit MUST flag stops much tighter than the investor's own convention, double coverage, orphans, and orders cancelled since the last snapshot.
- **FR-019**: The plugin MUST check held symbols for upcoming corporate actions and re-score affected standing orders against adjusted prices, marking unconfirmed dates as such.
- **FR-020**: Proximity to triggers MUST be measured against the live price, not the price stored when the order was created.
- **FR-021**: Any GTT change plan MUST place replacements before listing removals.

**Drafts and execution**
- **FR-022**: Every proposed action MUST first be output as a draft (GTT plan table or basket rows) the investor can read in full.
- **FR-023**: In the full edition, an order submission MUST be allowed only if it matches an investor-approved draft in every field; this check MUST NOT depend on model judgment.
- **FR-024**: The lite edition MUST NOT be able to submit orders.
- **FR-025**: Basket drafts MUST give symbol, exchange, quantity, LIMIT price and basis per row, the total, and the remaining cash, and MUST flag conflicts with verdicts or the cash rule.
- **FR-026**: Crash mode MUST use only the investor's saved staged deployment plan and MUST never propose tightening stops in a fall.

**State and onboarding**
- **FR-027**: Onboarding MUST create one state folder with a profile, a dated snapshot area and a log with a "Start here" block.
- **FR-028**: The profile MUST hold: goals, risk level, return target, cash buffer target and where it is held, allocation targets, GTT policy overrides, staged deployment plan, concentration limits, and per-symbol verdicts.
- **FR-029**: The plugin MUST offer a one-time import of an existing investor's notes into the profile, with confirmation per item and no snapshot numbers imported as rules.
- **FR-030**: Session start MUST read at most 20 KB of state; logs older than the current month MUST be archived automatically.
- **FR-031**: The plugin MUST NOT edit a standing verdict silently; contradictions go to the log.

**Analysis and guardrails**
- **FR-032**: Stock analysis MUST quote a source and data period for every figure or say "not found in sources", include a Sources list with links, contain no buy/sell instruction, and stop after a bounded search.
- **FR-033**: The plugin MUST NOT suggest securities to buy.
- **FR-034**: The house rules MUST be active from the first response in every supported environment; where safeguards cannot load, the plugin MUST say so in its first response.
- **FR-035**: Market levels from web search that cannot be dated to the session date MUST be shown as low-confidence and not used in a verdict.
- **FR-036**: Macro briefings MUST map rate moves to the investor's holdings using a default sensitivity table by sector and instrument class (most exposed: mid/small-cap equity, consumer-credit-driven autos and durables, NBFCs, long-duration debt; mixed: banks; least exposed: exporters such as pharma and IT, foreign-equity funds, energy/PSU), overridable per symbol in the profile, with a reminder to re-check exposed holdings before each central-bank policy meeting.

**Product surface and delivery**
- **FR-037**: The plugin MUST expose at most 6 user-facing workflows (get started, check, GTT, risk, crash, analyze); previous trigger phrases ("daily briefing", "open session", "EOD analysis", "audit GTTs", "review my MFs", "risk check") MUST still route to the right workflow.
- **FR-038**: Two editions (full and lite) MUST be built from one source.
- **FR-039**: Every change MUST pass automated validation, order-protection matching tests, computation tests on recorded data, and a policy lint; every release MUST also pass behavioural tests for loading, house rules, order protection and sourced analysis.
- **FR-040**: The repository MUST contain no personal portfolio data; recorded test data MUST be scrubbed.

### Key Entities

- **Profile**: the investor's rules and preferences (FR-028); versioned; the single source for thresholds and verdicts.
- **Verdict**: per-symbol stance (hold, add, reduce, exit) with a written reason and optional exit level.
- **Snapshot**: dated, per broker and per symbol: quantity, value, P&L, cash, standing orders; the basis for differences.
- **Standing order (GTT)**: id, symbol, type (single/two-leg), triggers, quantity, status, creation price.
- **Draft**: a proposed order set (GTT plan or basket) with its rows, status (draft/approved/executed) and approval time.
- **Broker status**: per broker per run: live, needs login, outage; consecutive unverified count.
- **Log entry**: dated record of findings, decisions and actions; plus the "Start here" block.
- **Staged deployment plan**: index levels, share of corpus per stage, destination split.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A daily check after login completes in under 60 seconds and uses under 30K tokens on a 50-holding, 40-standing-order book.
- **SC-002**: Two runs on identical broker data produce identical figures in 10 of 10 trials.
- **SC-003**: The investor logs in at most once per broker per day; zero login prompts for a broker reported live.
- **SC-004**: Zero first-request timeouts surfaced to the investor across 10 cold starts.
- **SC-005**: Zero orders submitted without a matching approved draft in the order-protection test suite (100% of mismatches blocked).
- **SC-006**: GTT audit detects 100% of seeded quantity gaps, policy violations and -20% crash-test hits in the recorded test book.
- **SC-007**: Session start reads at most 20 KB of state after 6 months of daily use.
- **SC-008**: A new investor completes onboarding and first check in under 15 minutes.
- **SC-009**: Both editions load with house rules active in a fresh session of every supported environment before each release.
- **SC-010**: Dogfood gate: the original investor plus 3 others use it at least weekly for 4 consecutive weeks (Nov-Dec 2026).

## Assumptions

- Brokers in scope for live connection: Zerodha (Kite), Kotak Neo, Interactive Brokers (read-only); others via statement import as today.
- Investors do not need to create broker developer API credentials; the plugin uses the brokers' hosted connectors. If that blocks FR-006 or payload size, a credential-based option is a later, optional addition.
- Broker daily token expiry is unchanged; unattended runs cannot pull Indian broker data.
- Known connector gaps stay out of scope and are raised upstream: GTT delete/modify failures, compact GTT payload, MF/SIP order data, Kotak completeness flag, first-party corporate-action feed.
- Trigger phrases in English only.
- The default cash-buffer location is "at the broker" unless the investor's profile says otherwise.
- The lite edition's eligibility for Anthropic's directory is confirmed separately with Anthropic; it does not block this release.
