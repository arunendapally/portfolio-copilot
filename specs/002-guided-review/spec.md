# Feature Specification: Guided review, decision rules and a model-light engine

**Feature Branch**: `002-guided-review`

**Created**: 2026-11-12

**Status**: Draft

**Input**: User description: "I struggle with the decisions every investor struggles with: when to add, reduce, exit, re-enter, rebalance, switch, change contributions, with capital gains tax, drift and concentration in view. My main issue: I lose the gains instead of booking profits, and the stock comes back to near what I bought. Make the whole process a workflow with gates and conditions that takes me from start to end: at day start I ask for a review, you research the whole portfolio, suggest tasks and say why, and on my approval you execute; if you cannot, tell me exactly what to do by hand. It should first connect to every broker automatically where it can, tell me it is connected to all, and then start working. MCP is costing a lot of tokens: can this be an app that involves the LLM only when needed?"

Sources: the investor's `feedback.md` (roadmap block of 12-Nov-2026 and the dated entries of 11-Nov and 12-Nov-2026), the whole-plugin review of v0.7.3, constitution v1.0.0. No investor numbers appear in this folder (constitution, Constraints: no personal data in the repo); every example uses made-up symbols.

Product owner and architect for this feature: Claude, on the investor's instruction of 12-Nov-2026. `spec.md` is the product view (what and why). `plan.md`, `research.md`, `data-model.md` and `contracts/` are the architecture view (how).

## Why now

1. **A safety hole.** On 11-Nov-2026 Zerodha replaced every Kite MCP tool with grouped tools that take a `mode`. The plugin recognises broker tools by the last word of the tool name, so its order gate no longer sees Kite order or GTT writes, its capture hook saves no Kite read, and its drafts name tools that no longer exist.
2. **The product stops one step short.** It reports and audits, but the investor still has to work out what to do, in what order, and why. The decisions that cost money (not booking gains, late trims, drift) have no rule that fires.
3. **Cost.** A daily session spends most of its tokens moving broker payloads through the model and redoing arithmetic the engine already knows. The constitution's budget (Principle VI: under 30K tokens for a daily check) is not met in practice.

## User Scenarios & Testing *(mandatory)*

Actors: **Investor** (a busy DIY Indian retail investor with one or more broker accounts), **Maintainer** (ships the plugin).

Delivery order: US1 ships alone as a hotfix. US2, US3 and US6 ship together. US4 and US5 follow. US7 and US8 come last and are optional for an investor who is happy with chat-only use.

### User Story 1 - Safe and working again after a broker renames its tools (Priority: P1)

A broker changes the names or shapes of its tools. The plugin keeps guarding every order and standing-order change, keeps capturing reads, and says plainly when it meets a tool it does not know, instead of silently letting a write through or reporting an outage.

**Why this priority**: Principle I is non-negotiable and is currently not enforced for one broker. Nothing else may ship before this.

**Independent Test**: with the 12-Nov-2026 Kite tool list loaded, attempt a GTT place, a GTT delete and an order place with no approved draft: all three are denied by code. Read holdings, GTTs, margins and funds once each: `broker_status` reports Kite live. Repeat with the pre-11-Nov tool names: same result.

**Acceptance Scenarios**:

1. **Given** no approved draft, **When** any broker tool call would place, change, cancel or delete an order or a standing order, under old or new tool names, **Then** it is denied before it reaches the broker, with a reason.
2. **Given** an approved GTT plan, **When** the calls listed in the plan are made with exactly the shown arguments, **Then** each passes once and a repeat is denied.
3. **Given** a broker tool the plugin has never seen, **When** it is called, **Then** it is denied with "unknown broker tool, run doctor" unless it is on the known read list, and the gap is logged.
4. **Given** the investor reads holdings, standing orders, cash and funds through the new tools, **When** status is checked, **Then** the broker shows live with the read time.
5. **Given** a tool the plugin expects is missing from the chat, **When** status is checked, **Then** the status is "tools changed" naming the missing capability, never "outage" and never "log in again".
6. **Given** a broker order tool answers "approval required" with a link (the broker's own second approval), **When** the plan is executed, **Then** the plugin shows the link, reports that nothing has been placed yet, and verifies by reading orders afterwards.

---

### User Story 2 - Connect first, then work (Priority: P1)

The investor opens a session and asks for anything that needs live numbers. Before any analysis the plugin connects to every enabled broker by itself where it can, asks for every manual step in one message, then prints one line per broker and only then starts.

**Why this priority**: every session starts here, and today it takes several exchanges, wrong login prompts and no clear "ready".

**Independent Test**: with one broker whose session renews by itself, one that needs a QR scan and one that needs nothing, start a session. The investor sees exactly one message asking for the QR scan, then three status lines, then the work begins.

**Acceptance Scenarios**:

1. **Given** a broker session that can renew without the investor, **When** the session starts, **Then** no login is requested for it.
2. **Given** two brokers need a manual step, **When** the session starts, **Then** both steps are asked for in a single message, each with a link or instruction that came from the broker's own tool.
3. **Given** all brokers answered, **Then** the investor sees one line per broker (connected, data time) and a single "all connected" line before anything else.
4. **Given** one broker cannot be connected, **When** the investor says "go on without it", **Then** the run continues, that broker's last data is carried and labelled with its age, and every figure that depends on it says so.
5. **Given** the run is unattended, **Then** no login is requested; the run reports per broker what is needed and continues with labelled old data.

---

### User Story 3 - A guided daily review from start to end (Priority: P1)

The investor says "review". The plugin walks a fixed sequence: connect, pull, research, evaluate, propose, execute, verify, record. Each stage has a condition that must hold before the next starts. The investor receives a short list of proposed tasks, each with what, why (which of their own rules fired and on what numbers), what it costs, and who will do it. They approve, defer or decline each. Approved tasks are executed by the plugin where it can, or handed to the investor with exact steps where it cannot, then verified, then recorded.

**Why this priority**: this is the product. It turns reports into decisions and removes the daily "what should I look at" effort.

**Independent Test**: on a recorded book with one standing-order quantity gap and one index fund carrying a stop-loss against policy (both found by today's GTT audit, so no US4 or US5 rule is needed), run a review. The run proposes two tasks with reasons, the investor approves one and defers one, the approved one produces a draft and (after the Yes click) is executed and verified, the deferred one stays open with its reason, and the log, the task list and the run record agree.

**Acceptance Scenarios**:

1. **Given** a review is started, **Then** stages run in the fixed order and a stage whose condition fails stops the run with the reason and the one thing needed to continue.
2. **Given** today's data is partly old, **When** tasks are proposed, **Then** no task that depends on the old part is offered for execution; it is shown as "needs fresh data".
3. **Given** proposed tasks, **Then** each shows: what, why (rule and measurements with time and base), options including "do nothing", the effect of each option on drift and concentration, and the executor (plugin / investor / blocked).
4. **Given** nothing is due, **Then** the review says "nothing due" in one line and closes after recording.
5. **Given** an approved task the plugin can do, **Then** it creates a draft and executes only after the investor clicks Yes on that exact draft (unchanged from today).
6. **Given** an approved task the plugin cannot do, **Then** the investor gets numbered manual steps, the run waits for "done", and verifies by reading the broker again.
7. **Given** the session drops mid-run, **When** the investor says "review" again the same day, **Then** the run resumes at the stage it reached with task decisions intact.
8. **Given** a task was executed but verification does not confirm it, **Then** it stays open, flagged "not confirmed", and the run cannot close as complete.
9. **Given** research is needed, **Then** only names with an event (results due, a tripwire to check, a corporate action) are researched, every figure carries a source and date, and research alone never creates a task.
10. **Given** an end-of-day or Friday review is asked for, **Then** the same run executes with fewer stages (end of day) or with a read-back of past decisions (Friday).

---

### User Story 4 - Keep the gains (Priority: P2)

The investor sets a profit-lock rule once. From then on, when a holding's gain passes their first threshold the plugin proposes raising its stop to cost; past the second it proposes booking a slice; after that it proposes trailing the stop under the highest close. Stops only move up.

**Why this priority**: the investor's stated main loss: gains that were never protected and went back to cost. It is P2 only because it builds on US1 and US3.

**Independent Test**: on a recorded book where one stock is above the first threshold with a stop below cost, the GTT audit reports "gain unprotected" for it, a review proposes the stop raise with the reason, and the drafted plan places the new stop before deleting the old one.

**Acceptance Scenarios**:

1. **Given** profit lock is not configured, **Then** nothing changes in audits or plans, and a review offers once to set it up.
2. **Given** thresholds are saved, **When** a holding in scope passes the arm threshold with its stop below cost, **Then** a task proposes raising the stop to cost.
3. **Given** a holding passes the booking threshold, **Then** a task proposes selling the configured share, shows the holding period and the tax note, and names where the proceeds go under the investor's rule.
4. **Given** a holding is trailing, **When** its highest close rises, **Then** a task proposes the new stop; when price falls, no task proposes lowering it.
5. **Given** index and commodity funds, **Then** profit lock never applies to them.
6. **Given** a holding sold by a trailing stop, **Then** it is listed for re-entry review with the date and the investor's cooling-off period, and a buy of it inside that period is flagged.
7. **Given** the investor asks "what would this arm today at X and Y", **Then** a table lists the holdings that would arm, book or trail, without saving anything.

---

### User Story 5 - Decisions due, from my own rules (Priority: P2)

The investor's rules for adding, reducing, exiting, rebalancing and changing contributions live as data. Each review evaluates them and produces at most five cards. Each outcome is journaled and read back later.

**Why this priority**: it generalises US4 to the rest of the investor's decision list.

**Independent Test**: with drift bands, limits and one tripwire saved, a recorded book that breaches one band and one limit yields exactly two cards with correct bases; after deciding them, the Friday review lists both decisions with what happened since.

**Acceptance Scenarios**:

1. **Given** a bucket is outside its band, **Then** a card proposes closing it with new money first and shows the amount.
2. **Given** a stock, a sector or a fund house is over its limit, **Then** a card shows the excess with its base named; sector funds count toward the sector when the investor's map says so.
3. **Given** a saved tripwire and a researched figure with source and date that crosses it, **Then** a card proposes the exit path written in the verdict; without a sourced figure no card appears.
4. **Given** the book is behind the investor's plan path by more than their tolerance, **Then** a card shows the monthly change that closes the gap.
5. **Given** more than five rules fire, **Then** five cards are shown in fixed priority order and the rest are counted as "also due".
6. **Given** a card is decided, **Then** the decision, the reason and the measurements at that time are journaled, and the Friday review shows them.
7. **Given** a rule has no threshold saved, **Then** it is skipped and listed once as "not set", never filled with a silent default.

---

### User Story 6 - One state wherever I chat (Priority: P1)

The investor's profile, snapshots, drafts, runs and log stay consistent whether the chat runs on their computer or in the cloud. A cloud session works on a bundle it loaded and writes it back before ending; if it cannot, it says the computer's copy is behind.

**Why this priority**: today the two sides drift; snapshots go missing for weeks and approvals fail with "no open draft". The guided run needs a reliable record.

**Independent Test**: start a review in a cloud chat linked to the computer, close it, and open the folder on the computer: today's snapshot, the run record and the log entry are there and match what the chat showed.

**Acceptance Scenarios**:

1. **Given** a cloud chat linked to the computer, **When** a run starts, **Then** state is loaded from the computer in one step and its age is shown.
2. **Given** the run ends or the investor says "save", **Then** changed files are written back in one step and listed.
3. **Given** a write fails anywhere, **Then** the command fails loudly; nothing reports success.
4. **Given** no profile can be found, **Then** drafting commands refuse to run; reporting commands run on defaults with a warning.
5. **Given** state on the computer changed since it was loaded, **When** writing back, **Then** the conflict is reported and nothing is overwritten.

---

### User Story 7 - The model only when it adds something (Priority: P3)

The investor runs a small local engine on their computer. It pulls broker data itself once a day after one login step, keeps snapshots, runs every rule and serves the daily view. The chat talks to it through a few compact tools and is used for research, explanations and conversations about rules.

**Why this priority**: it cuts cost by an order of magnitude and makes unattended runs useful, but it changes Principle IV and needs the investor's decision on how the engine reaches each broker.

**Independent Test**: with the local engine running and logged in, a morning review in chat completes with no raw broker payload in the conversation and within the token budget in Success Criteria.

**Acceptance Scenarios**:

1. **Given** the local engine has today's data, **When** the chat asks for a review, **Then** the chat receives summaries and cards only.
2. **Given** the local engine is not running, **Then** the plugin works as in US1 to US6 through the broker tools in chat.
3. **Given** the local engine, **Then** it never places, changes or cancels an order; execution stays in chat behind the order gate, or with the investor.
4. **Given** today's snapshot, **Then** the engine can export the files the investor's dashboard reads, with a per-holding data time.
5. **Given** a year of daily prices is available to the engine, **Then** averages and momentum figures used by rules are computed in code and dated.

---

### User Story 8 - Tax in view on every sell (Priority: P3)

Every card that sells or switches shows the holding period per lot, the realised gains so far this financial year, and what is left of the investor's exemption, from statements the investor imports.

**Why this priority**: it makes reduce, switch and year-end decisions honest, but needs lot data no broker tool provides today.

**Independent Test**: import a recorded tradebook and fund statement; a card that sells part of a holding shows which lots it uses, short or long term for each, and the remaining exemption.

**Acceptance Scenarios**:

1. **Given** imported statements, **Then** lots are built per holding first-in first-out and reconcile to held quantity, or the mismatch is shown.
2. **Given** no statements, **Then** sell cards say "tax not computed: import statements" and still work.
3. **Given** tax rates and the exemption amount, **Then** they come from the investor's profile, are dated, and cards say "confirm with your tax adviser".

---

### Edge Cases

- Market closed or a holiday: prices are the last close and say so; execution tasks are offered as drafts for the next session.
- A broker returns a partial list (paging): the read is marked partial and cannot make that broker live.
- Same-day buys not yet in holdings: counted toward held quantity for standing-order coverage, labelled "today".
- A suspended or delisted holding reported at cost: valued at zero once flagged, shown separately.
- The same fund or stock held at two brokers: one position for limits; the fresher price wins.
- A foreign-currency account without a dated exchange rate: excluded from totals with a note, never converted at an undated rate.
- A corporate action between snapshots: profit-lock high and stops are re-based only after a confirmed ex-date; until then tasks for that symbol are held.
- Two reviews started on the same day from two chats: the second resumes the first; it never starts a parallel run.
- The investor approves a task, then the price moves past the drafted trigger before execution: the draft is rejected by verification and re-proposed.
- A rule change mid-run: the run finishes on the rules it started with and says so.

## Requirements *(mandatory)*

### Functional Requirements

**Broker tools and the order gate (US1)**

- **FR-001**: The plugin MUST keep one table of every broker tool it knows, with for each: broker, tool name, mode where the tool has one, whether it reads or writes, and the capability it provides (holdings, standing orders, cash, funds, orders, positions, prices, session, order write, standing-order write).
- **FR-002**: Hooks, capture, status, drafts and skills MUST take tool names from that table only. No other file may hold a broker tool name.
- **FR-003**: The order gate MUST run for every call to a tool of an order-capable broker and MUST deny any call the table marks as a write unless it matches an unused row of a draft the investor approved.
- **FR-004**: The order gate MUST deny a call to a broker tool that is not in the table, with a reason that names the tool, and MUST log the gap.
- **FR-005**: The table MUST carry both the tool names in use before 11-Nov-2026 and those observed on 12-Nov-2026 for Kite, and the current Kotak Neo and IBKR names.
- **FR-006**: Drafts MUST name the write calls using the table, in the form the connected broker currently exposes.
- **FR-007**: A read MUST be treated as partial when the broker says more rows exist or when it was requested from an offset; a partial read MUST NOT make a broker live.
- **FR-008**: Status per broker MUST be one of: live, needs login, tools changed, not connected, stale, outage, format error. "Outage" MUST NOT be used for a missing or renamed tool.
- **FR-009**: A session-start check ("doctor") MUST compare the tools present in the chat with the table and report, per enabled broker, whether a read path and a write path exist.
- **FR-010**: When a broker's own tool asks for a second approval, the plugin MUST treat the order as not placed until a later read confirms it.

**Connect first (US2)**

- **FR-011**: One command MUST return, for every enabled broker, its state and the exact next calls to make, in an order that tries silent renewal before any login.
- **FR-012**: Manual steps for all brokers MUST be presented in one message. Login links MUST come from a broker tool's output.
- **FR-013**: The run MUST print one line per broker and a single summary line before any analysis output.
- **FR-014**: The investor MUST be able to continue without a broker; its data is then carried and labelled.

**Guided review (US3)**

- **FR-015**: A review MUST be a recorded run with the stages connect, pull, research, evaluate, propose, execute, verify, record, each with a pass condition evaluated in code.
- **FR-016**: The run MUST be resumable on the same day and MUST be the only run for that day and kind.
- **FR-017**: Tasks MUST be produced only by rules evaluated in code. Research MUST enter the run as structured findings with a source and date and MAY only supply measurements to rules.
- **FR-018**: Each task MUST carry: kind, title, the rule it came from, the measurements with time and base, options including "do nothing", the effect of each option on allocation and concentration, urgency, and executor.
- **FR-019**: The executor MUST be decided in code: plugin (a draft can be made and executed through the gate), investor (manual steps), or blocked (logged as a gap).
- **FR-020**: Task decisions (approve, defer, decline, with a reason) MUST be recorded in the run. A task approval MUST NOT authorise any order; every order still needs the Yes click on its exact draft.
- **FR-021**: Manual tasks MUST come with numbered steps from a template per kind, and MUST be verified by a fresh read.
- **FR-022**: A run MUST close only after the log entry, the task list sync and the state write-back succeeded, and MUST say which did not.
- **FR-023**: Three run kinds MUST exist: full, end of day (connect, pull, evaluate, record) and Friday (adds the decision read-back).
- **FR-024**: At most five tasks are proposed per run in a fixed priority order; the rest are counted.
- **FR-025**: An unattended run MUST stop before propose and wait.

**Profit lock (US4)**

- **FR-026**: The profile MUST hold a profit-lock rule: on or off, scope, arm threshold, booking threshold, share to book, trail distance, re-entry cooling-off. It is off until the investor sets every value. The plugin MUST NOT supply default thresholds.
- **FR-027**: The engine MUST track, per holding in scope, the highest close since tracking began and the lock stage (idle, armed, booked, trailing).
- **FR-028**: Proposed stops MUST never be lower than the current stop for a locked holding.
- **FR-029**: The GTT audit MUST report "gain unprotected" for a holding past the arm threshold whose stop is below cost, when the rule is on.
- **FR-030**: Locked holdings MUST be exempt from the minimum stop distance and reported separately in the crash test.
- **FR-031**: A dry run MUST list what would arm, book or trail at thresholds given on the command, without saving.
- **FR-032**: Each holding MUST be classed core or play; by default funds are core and single stocks are play, and the investor can override per symbol.

**Decision rules (US5)**

- **FR-033**: The profile MUST hold drift bands per bucket, limits (single stock, sector, fund house) with their bases, tripwires per symbol, a plan path for contributions, and a re-entry list.
- **FR-034**: The sector map MUST allow funds to count toward a sector and MUST name the base used for the limit.
- **FR-035**: Rule evaluation MUST be deterministic: the same snapshot, profile and findings give the same tasks with the same identifiers.
- **FR-036**: Every decided task MUST be journaled with measurements at decision time; the Friday run MUST read back decisions older than a set number of days with current measurements beside them.
- **FR-037**: A rule with a missing threshold MUST be skipped and reported as not set.

**State (US6)**

- **FR-038**: The engine MUST export and import the state a run needs as one bundle, and MUST report its age and whether the source changed since export.
- **FR-039**: Any failed write MUST fail the command.
- **FR-040**: Drafting commands MUST refuse to run without a real profile.
- **FR-041**: The log target MUST be configurable so the investor's own log file can be the single log.

**Valuation fixes that rules depend on**

- **FR-042**: A holding flagged as frozen at cost for two runs MUST be valued at zero and listed separately, unless the investor overrides its value.
- **FR-043**: Every holding MUST carry the time its price refers to; when two brokers hold the same instrument, the fresher price is used for both.
- **FR-044**: Same-day buys MUST be included in held quantity for standing-order coverage.
- **FR-045**: A fund held at two brokers MUST be one position when its identifier or its normalised name matches.
- **FR-046**: Broker cash that cannot be parsed MUST be reported as unknown, never as zero, and the broker is not live.

**Local engine (US7)**

- **FR-047**: The engine MUST be able to run as a local service on the investor's computer that pulls broker data without the model, after at most one manual step per broker per day.
- **FR-048**: The local service MUST be read-only toward brokers.
- **FR-049**: The chat MUST reach the local service through at most four tools whose results are summaries.
- **FR-050**: When the local service is absent, every other story MUST still work through broker tools in chat.
- **FR-051**: The engine MUST export the dashboard data files from a snapshot.
- **FR-052**: With price history available, the engine MUST compute dated averages and momentum figures in code.

**Tax (US8)**

- **FR-053**: The engine MUST build lots from imported statements and reconcile them to holdings.
- **FR-054**: Sell and switch options MUST show per-lot holding period, realised gains for the financial year and remaining exemption, using rates and amounts saved and dated in the profile.

**Maintainer**

- **FR-055**: Skills MUST stay within six, each under sixty lines; skills MUST NOT name broker tools: they describe capabilities, and the exact calls come from `pc doctor` and from draft output, both generated from the tool map at run time.
- **FR-056**: Tests MUST cover every tool name in the table for gate and capture, and the review state machine, on made-up or scrubbed fixtures.
- **FR-057**: Gaps that could not be filed online MUST be queued and filed at the next session that can.

### Key Entities

- **Broker tool map**: what each broker tool is called and what it does. One source for every component.
- **Run**: one review on one day: kind, stage reached, gate results, tasks, timestamps.
- **Task**: a proposed action with its reason, options, executor, decision and outcome.
- **Rule set**: the investor's bands, limits, tripwires, profit lock, plan path and re-entry list, stored in the profile.
- **Finding**: a researched figure with symbol, metric, period, source and date.
- **Mark**: per-holding tracking for profit lock: highest close, since when, stage.
- **Decision journal**: decided tasks with measurements at the time.
- **State bundle**: profile, recent snapshots, open drafts, today's run, marks and the log tail, as one transferable unit.
- **Lot**: a purchase with date, quantity and cost, built from statements.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In the release evals, 100% of attempted order or standing-order writes without an approved draft are denied, under every tool name in the table.
- **SC-002**: After a broker renames a tool, the first session reports "tools changed" for that broker within the first reply; no write to that broker is possible until the table is updated.
- **SC-003**: From "review" to "all connected" takes at most one investor action per broker that truly needs one, and one message from the plugin.
- **SC-004**: A full review on a 50-holding book with brokers already connected finishes propose within 3 minutes, and within 30,000 tokens in chat-only use.
- **SC-005**: With the local engine, the same review uses under 8,000 tokens, and no broker payload larger than 2 KB enters the conversation.
- **SC-006**: On days with nothing due, the review output is under ten lines.
- **SC-007**: Every proposed task shows a reason traceable to one saved rule and to measurements with a time; in a review of 20 recorded runs, zero tasks lack either.
- **SC-008**: After four weeks of use with profit lock on, no holding in scope that passed the arm threshold has a stop below cost for more than one trading day without a recorded decision.
- **SC-009**: The investor's computer has a snapshot and a run record for every day a review was run, from any chat.
- **SC-010**: Zero commands report success after a failed write.
- **SC-011**: The investor rebuilds no dashboard data by hand: one command produces the files.
- **SC-012**: A new broker tool rename is fixed by editing one file plus its tests.

## Assumptions

- The investor uses Zerodha (Kite), Kotak Neo and Interactive Brokers; other brokers arrive by import as today.
- Broker sessions expire daily; one manual step per broker per day is acceptable, more is not.
- The plugin stays analysis-and-drafting: it never names securities to buy, and thresholds are always the investor's.
- Execution from the local engine is out of scope; regulation of API orders (vendor key, static address) makes it a separate decision.
- The investor's dashboard keeps its current data shape; the export matches it.
- Tax rules change; the profile holds the rates the investor confirmed, with a date.
- The investor's notes file remains the source for verdict reasoning; the profile is the source for rule values. "Import my notes" keeps them in step and is not redesigned here.

## Open decisions for the investor

These do not block US1, US2, US3 or US6.

1. **Profit-lock values** (US4): arm threshold, booking threshold, share to book, trail distance, cooling-off. The dry run in FR-031 exists to help choose. No defaults will be shipped.
2. **Loss tolerance measure** (US5) [NEEDS CLARIFICATION: is the tolerance on play trades measured on realised losses only, or realised plus open, and from which date?]
3. **How the local engine reaches each broker** (US7) [NEEDS CLARIFICATION: research.md R6 lists the options per broker with a recommendation; choosing one amends constitution Principle IV and needs the investor's sign-off.]
