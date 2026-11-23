<!-- Bug lane. Owner: builder agent; the pre-reviewer agent writes Pre-review. Gate: a CODEOWNER engineer, asked with "sdlc ask <feature>"; under autonomy it passes on its checks.
     One file from start to merge, and the PR body. Build passes on checks: the repro red before the fix,
     the gate green after, under the line limit (tasks.md Budget), and no change to dependency manifests,
     migrations, .github, infra or terraform (those make it a feature). Write Repro and Expected and actual
     before any fix.
     A required section with only a comment in it is empty, and the gate refuses it. Keep every "## " heading
     exactly as written; never start a line with "# " or "## " inside a section.
     Every line states a fact with its source: a test, a command run on this commit, a file:line or a link;
     end one you did not check with [unconfirmed]. -->

## Repro

<!-- The failing test, then the steps and the report. Without a proofCommand: run "sdlc gate <slug>" now;
     it must go red on this test. With one: after the fix, "sdlc proof <slug> --files <test file>" must pass
     here and fail on the base. Example:
Test: tests/stock/events.test.ts "a sold-out item is marked in every saved list"
Steps: two shoppers save "Blue mug"; "Blue mug" sells out; the second shopper opens their saved list
Report: issue #212 -->

## Expected and actual

<!-- Two lines, observed values only. Example:
Expected: both saved lists show "Blue mug" as "Sold out" within 5 minutes (R2)
Actual: the first shopper's list shows "Sold out"; the second still shows "In stock" after 30 minutes -->

## Root cause

<!-- Why, not where: the wrong assumption at its file:line, then the trap. If opened with --caused-by, the
     merge waits for that trap with "- **Source:** <slug>" and a "Guard now" that is a test, hook, lint
     rule, CI check or eval. Example:
src/stock/events.ts:31 looks up one saved row for the item (LIMIT 1), assuming one shopper per item.
Trap: an update meant for every row written as a single-row lookup (new: added to standards/traps.md) -->

## Fix

<!-- What changed, why it is the smallest safe change, and what was left alone. Example:
src/stock/events.ts:31: mark every saved row for the item in one UPDATE (3 lines). The save path was right and is unchanged. -->

## Test results

<!-- One line per fact, each from a command run on this commit. Any line that is not all green or "none"
     names the test and the reason. Example:
Repro: tests/stock/events.test.ts "a sold-out item is marked in every saved list" red on the base (4e5f6a7), green on this commit
Suite: 141 passed, 0 failed, 0 skipped (baseline 140)
Gate: types, lint and secret scan clean (sdlc gate <slug>)
Removed, skipped or quarantined: none -->

## Pre-review

<!-- Written by the pre-reviewer agent before any human looks. Keep each line prefix exactly as shown: the gate reads them. Example:
Risk: medium, because it changes code (src/stock/events.ts) and touches no high-risk path
Open findings: 0
Look here first: src/stock/events.ts:31 (one UPDATE over every saved row: is the item index enough at 3 M rows?)
Lenses run: correctness, data, tests
Revert: git revert of the merge commit; no data to back out
Checked mechanically: checklist 1 to 9, 13 to 16; the repro fails on the base; no secrets
Could not check: the UPDATE time at production volume

Risk: never below the floor the change sets; the gate refuses a lower label.
  low     only *.md, *.txt, docs/ and specs/ files (a file on a high path stays high)
  medium  any other change, behind a flag or not, including copy inside code files
  high    auth, payments or migrations folders, infra/, terraform/, .github/, CODEOWNERS, .claude/agents/, .claude/hooks/, .mcp.json,
          a .sql or Prisma schema that drops, renames or alters, and any path in the repo's highRiskPaths or askPaths
Open findings: open blocker, major and minor rows in specs/<feature>/review.md. Must be 0; open nits may stay, named: "Open findings: 0 (nits left open: F5)".
Look here first: two or three file:line places that need human judgement, each with the question to decide. Never a place you already proved.
Lenses run: the lenses that ran, by name. An empty ledger is valid; this line says what was looked at.
Revert: the one step that undoes this (git revert of the merge, a flag off), and whether data must be backed out first. -->

## Not verified

<!-- What nobody checked, and why, one line each. The gate prints this section to the approver. Example:
The UPDATE time on 3 M saved rows: ran on 10 k rows only.
     Or: None, because the repro and every changed line are covered by the suite above. -->
