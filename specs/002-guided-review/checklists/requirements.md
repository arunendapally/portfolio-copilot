# Specification Quality Checklist: Guided review, decision rules and a model-light engine

**Purpose**: Validate specification completeness and quality before proceeding to implementation
**Created**: 2026-11-14
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details in spec.md (languages, frameworks, APIs); they live in plan.md and contracts/
- [x] Focused on user value and business needs
- [x] Written for the investor as reader; domain terms (GTT, ETF, broker) are product vocabulary for this audience
- [x] All mandatory sections completed

## Requirement Completeness

- [ ] No [NEEDS CLARIFICATION] markers remain — two remain by design (loss-tolerance measure, local-engine broker route). Both are owner decisions, block only US5's tolerance card and US7, and are tracked as T079, T081 and T082
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic except SC-005's payload size, which is the point of US7
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded (execution from the local engine is out of scope; analysis-only stance kept)
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements map to a task in tasks.md
- [x] User scenarios cover primary flows: hotfix, connect, guided review, state, profit lock, decisions, local engine, tax
- [x] Each user story has an independent test
- [x] No investor data appears anywhere in the folder

## Traceability (FR → task)

| FR | Tasks |
|---|---|
| FR-001 to FR-010 | T008 to T021, T024 |
| FR-011 to FR-014 | T026 to T032 |
| FR-015 to FR-025 | T040 to T059 |
| FR-026 to FR-032 | T061 to T069 |
| FR-033 to FR-037 | T070 to T078 |
| FR-038 to FR-041 | T033 to T039 |
| FR-042 to FR-046 | T019, T043, T045 to T047 |
| FR-047 to FR-052 | T081 to T095 |
| FR-053, FR-054 | T096 to T099 |
| FR-055 | T023, T058 |
| FR-056 | every test task |
| FR-057 | T022 |

## Notes

- The two open markers are intentional: deciding them is the investor's call, and the spec should not ship a default for either.
- Profit-lock thresholds are deliberately absent from every file (FR-026). Numbers in quickstart.md are test inputs only.
