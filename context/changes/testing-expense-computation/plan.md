# Expense computation correctness (Risk #6 unit tests) Implementation Plan

## Overview

Make the category-aggregation and month-over-month (MoM) computations
**unit-testable**, then pin the documented business rules with a
deterministic unit suite (test-plan Risk #6). The rules are already correct
in the code; the blocker is that the pure functions are trapped, unexported,
inside the `CategorySummary.tsx` React island and two rules are render-
coupled. This plan extracts the compute into a pure `src/lib` module and
adds the unit layer the test plan calls for.

This is Phase 3 of `context/foundation/test-plan.md`, scoped to **Risk #6**.

## Current State Analysis

- **The math is correct but unreachable by a unit test.** `sumByCategory`,
  `computeMarker`, and `aggregate` are pure but **module-private** in
  `src/components/expenses/CategorySummary.tsx:45-78` (the only `export` is
  the default component, `:80`). A unit test cannot import them.
- **Two rules are render-coupled.** The **first-month gate**
  (`hasPrevMonth = prevExpenses.length > 0`, `CategorySummary.tsx:87,123`)
  and the **per-row percentage** (inline in JSX, `:122`) are not in any pure
  function.
- **The rules themselves are right** (verified in `research.md`): strict
  `>20%` symmetric (`delta > 0.2` / `< -0.2`, exactly ±20% skipped); zero-base
  guarded (`if (previous === 0) return null` before the divide); rounding
  applied after the threshold decision so it can't flip the boundary.
- **A Vitest harness exists** from `testing-rls-authorization` but is
  **integration-only**: `vitest.config.ts` has `include:
["tests/integration/**/*.test.ts"]`, a dotenv `setupFiles`, and serial
  execution. Unit tests need none of that and must run as a separate project.
- **Known MVP quirks** (accepted, not bugs): float/cents accumulation has no
  per-row rounding; the sum of rounded per-category percentages need not
  equal 100; there is no "Inne"/Other overflow bucket ("Inne" is one of the
  9 enum categories).

## Desired End State

`npm test` runs **two** Vitest projects — the existing integration suite and
a new fast unit suite — both green. The unit suite imports pure functions
from `src/lib/expenses-summary.ts` and asserts the Risk #6 rules (aggregation
totals, MoM marker boundaries, first-month hide) plus labelled
characterization tests for the accepted numeric quirks. The dashboard renders
exactly as before (the refactor is behavior-preserving).

Verification: `npm test` green; the dashboard is visually unchanged; a
deliberate rule break (e.g. `>` → `>=` on the threshold) fails a unit test.

### Key Findings

- Pure functions live at `src/components/expenses/CategorySummary.tsx:38-78`;
  the component consumes them at `:83,87,122,123`. `formatAmount` is already
  exported in `src/lib/format.ts:1-8` (the repo's `src/lib` convention).
- Assert from the **PRD rules**, never the functions' current output — the
  oracle-problem anti-pattern the test plan flags for Risk #6.
- Importing a `.tsx` into a node unit test would pull React/Recharts/lucide
  into the test module graph; a plain `.ts` module avoids that — the reason
  for extraction over export-in-place.
- The `@/*` alias is already resolved in `vitest.config.ts:10-13`.

## What We Are NOT Doing

- **Date-window / timezone logic** (`toLocalISODate` + the month-range calc
  in `src/pages/api/expenses.ts:11-48`) — named in Risk #6 but **already
  fixed** (the `monthly-comparison` change, review F1) and currently covered
  by that change's manual checks. Extraction + unit tests for it are a cheap
  deferred follow-up, not this plan.
- **The per-row percentage** (`CategorySummary.tsx:122`) — not in the agreed
  coverage; stays inline in JSX.
- **Any change to computation behavior.** The refactor is strictly
  behavior-preserving; if a quirk looks wrong, that's a separate change.
- **RTL / component / DOM tests**, snapshot tests (test-plan §7), and the
  **CI test step** (test-plan Phase 5; `.github/workflows/ci.yml` untouched).

## Implementation Approach

Extract the compute into `src/lib/expenses-summary.ts` as plain exported
functions, including one **marker-resolution function** that takes the
current and previous expense arrays and returns each row with its optional
marker — folding the first-month gate and zero-base/threshold logic into one
pure, composable decision. `CategorySummary.tsx` becomes a thin consumer that
imports and renders. Then add a Vitest `unit` project so unit tests run
fast (no DB, no dotenv, parallel) alongside the serial integration project,
and write the Risk #6 suite plus the characterization tests.

## Critical Implementation Details

- **Behavior-preserving extraction first.** Phase 1 must not change any
  output: move the functions verbatim, keep the `total > 0` filter, the
  descending sort, the color cycling, the `MOM_THRESHOLD = 0.2` strict
  comparison, and the `previous === 0` guard exactly as-is. The only new
  logic is composing the existing first-month gate into the marker-resolution
  function (semantically identical to the current `hasPrevMonth ? … : null`).
  Guard the refactor with `npm run build` + typecheck + lint + a manual
  dashboard render, since no unit tests exist yet to catch a regression.
- **Characterization tests are current-behavior, not spec.** Label the
  float/cents, sum-of-rounded-%≠100, and no-"Inne"-bucket tests explicitly as
  characterization (documenting incidental output). They assert _current_
  behavior, so a future intentional numeric-model change is expected to update
  them — unlike the rule-based tests, which assert the PRD and should only
  change if the rule changes.

---

## Phase 1: Extract compute to a pure module

### Overview

Move the aggregation + marker logic out of the React island into an exported
`src/lib` module, with first-month folded into a marker-resolution function,
changing no behavior.

### Required changes:

#### 1. New compute module

**File**: `src/lib/expenses-summary.ts` (new)

**Purpose**: Hold the pure, exported computation functions so they can be
unit-tested without rendering the component or touching the DB.

**Contract**: Export, with behavior identical to the current private versions
in `CategorySummary.tsx:45-78` —

- `sumByCategory(expenses): Map<ExpenseCategory, number>`
- `computeMarker(current, previous): Marker | null` — strict `>0.2` /
  `<-0.2`, `previous === 0 → null`, `Math.round` percent after the decision.
- `aggregate(expenses): { rows: CategoryTotal[]; total: number }` — `total>0`
  filter, descending sort, cycling `fill`, grand total over surviving rows.
- A new **marker-resolution** function, e.g.
  `resolveMarkers(currentExpenses, prevExpenses): CategoryRow[]` (or
  equivalent) that returns each aggregated current-month row plus its marker,
  applying the **first-month gate** (no previous data → every marker `null`),
  then per-row zero-base + threshold. This is the composed decision the
  component uses today (`CategorySummary.tsx:87,123`), now pure and testable.
- Export the supporting types (`Marker`, `CategoryTotal`/`CategoryRow`) and
  the `MOM_THRESHOLD` constant as needed. `CATEGORY_COLORS` may move with
  `aggregate` or stay in the component and be passed in — implementer's call,
  as long as output is identical.

#### 2. Rewire the component

**File**: `src/components/expenses/CategorySummary.tsx`

**Purpose**: Consume the extracted functions instead of local definitions, so
the island only renders.

**Contract**: Remove the local `sumByCategory` / `computeMarker` / `aggregate`
(and the now-composed first-month branch) and import from
`@/lib/expenses-summary`. The rendered output (donut, total, legend rows,
markers, percentages, empty state) must be unchanged. The inline percentage
at `:122` may stay in JSX (out of scope to extract).

### Success Criteria:

#### Automated Verification:

- Type-check passes: `npx astro sync && npx tsc --noEmit`
- Lint passes: `npm run lint`
- Production build succeeds: `npm run build`

#### Manual Verification:

- The dashboard renders identically to before (donut, totals, legend,
  up/down markers, percentages, empty state) for: a normal month, the first
  month (no previous data → no markers), and a zero-expense month.

**Implementation note**: After automated checks pass, stop for human
confirmation that the dashboard is visually unchanged before Phase 2.

---

## Phase 2: Unit runner + Risk #6 suite

### Overview

Add a separate Vitest unit project and write the deterministic Risk #6 suite
against the extracted module.

### Required changes:

#### 1. Vitest unit project

**File**: `vitest.config.ts`

**Purpose**: Run fast unit tests (no DB, no dotenv, parallel) separately from
the serial integration suite, under one `npm test`.

**Contract**: Convert to Vitest **projects** (Vitest 4 `test.projects`): an
`integration` project keeping the current config (include
`tests/integration/**`, the dotenv `setupFiles`, serial/`fileParallelism:
false`), and a `unit` project (include `tests/unit/**/*.test.ts`, node env,
no setupFiles, parallel ok, no `@/` change needed beyond the shared alias).
`npm test` (`vitest run`) must run both. Keep the integration project's
behavior unchanged.

#### 2. Risk #6 unit suite

**File**: `tests/unit/expenses-summary.test.ts` (new)

**Purpose**: Pin the documented Risk #6 rules deterministically, asserting
from the PRD, not from current output.

**Contract**: Cover —

- **Aggregation totals**: per-category sums; descending sort; the `total>0`
  filter drops zero/negative-net categories; grand total = sum of surviving
  rows; empty input → `{ rows: [], total: 0 }`.
- **MoM marker boundaries**: exactly +20% and −20% → `null` (no marker);
  just over (e.g. 20.001%) → marker with correct `direction`; `previous === 0`
  → `null` (zero-base, no Infinity/NaN); down > 20% → `down`; percent is the
  rounded integer.
- **First-month rule** (via the marker-resolution fn): empty `prevExpenses`
  → every row's marker is `null`; with previous data, per-row zero-base +
  threshold apply.
- Use small hand-built `Expense[]` fixtures (a tiny factory for
  `{ category, amount }`, other fields stubbed) — plain data in, asserted
  against the rule, no DB/render.

#### 3. Characterization tests (current behavior)

**File**: `tests/unit/expenses-summary.characterization.test.ts` (new)

**Purpose**: Document the accepted MVP numeric quirks so accidental drift is
caught — explicitly current-behavior, not spec.

**Contract**: A clearly-labelled file (top comment: "characterization —
asserts current behavior, update on intentional numeric-model changes")
covering: naive float accumulation (e.g. `0.1 + 0.2` style sub-cent result is
not pre-rounded); the sum of rounded per-category percentages can differ from
100 for a chosen fixture; an out-of-enum / "Inne" input is treated as its own
category (no Other-bucket rollup).

### Success Criteria:

#### Automated Verification:

- `npm test` runs both projects green (unit + integration)
- Unit suite alone runs green and fast: `npx vitest run --project unit`
- Lint passes: `npm run lint`
- Type-check passes: `npx tsc --noEmit`

#### Manual Verification:

- Temporarily changing `computeMarker`'s `>` to `>=` (or `MOM_THRESHOLD` to
  `0.0`) makes a boundary unit test fail — confirming the suite bites.
- The characterization file reads as current-behavior documentation (its
  intent comment is present and accurate).

**Implementation note**: Stop for human confirmation that the rule-break
check was observed before marking the phase done.

---

## Phase 3: Cookbook + test-plan wiring

### Overview

Document the unit-test pattern and advance the rollout state.

### Required changes:

#### 1. Cookbook + stack

**File**: `context/foundation/test-plan.md`

**Purpose**: Fill the §6.1 unit-test "TBD" with the concrete pattern and
record the unit layer.

**Contract**: §6.1 documents: pure functions live in `src/lib`; the Vitest
`unit` project (`tests/unit/**`, node, no DB/dotenv, parallel); assert from
PRD rules (avoid the oracle problem); characterization tests are labelled and
separate. §4 Stack: mark Vitest as also serving unit tests (version/date
already recorded). §3 Phase 3 Status: advance to reflect the shipped unit
suite (Risk #6 portion; note the date-window/TZ sub-scope deferred).

#### 2. Change status

**File**: `context/changes/testing-expense-computation/change.md`

**Purpose**: Record Risk #6 coverage and the deferred date-window sub-scope.

**Contract**: Update `status`/`updated` and a one-line note: aggregation +
MoM + first-month covered; `toLocalISODate`/month-window deferred.

### Success Criteria:

#### Automated Verification:

- Docs format clean: `npm run format`

#### Manual Verification:

- §6.1 reads as a usable recipe for adding a new unit test
- §3 Phase 3 row reflects the shipped unit suite

---

## Testing Strategy

### Unit tests:

- `tests/unit/expenses-summary.test.ts` — aggregation totals, MoM marker
  boundaries, first-month rule (rule-based, from the PRD).
- `tests/unit/expenses-summary.characterization.test.ts` — accepted MVP
  quirks (current-behavior).

### Integration tests:

- None added; the existing integration project is untouched.

### Manual Testing Steps:

1. `npm run build` + open the dashboard → confirm identical rendering
   (normal / first month / empty) after the Phase 1 refactor.
2. `npm test` → both projects green.
3. Flip `>` to `>=` on the threshold → a unit boundary test fails; revert.

## Performance Considerations

Unit tests are pure and parallel — milliseconds. Running them as a separate
project keeps them off the serial/local-Supabase integration path.

## Migration Notes

No data or schema migration. Phase 1 is a behavior-preserving code move; no
runtime behavior changes.

## References

- Related research: `context/changes/testing-expense-computation/research.md`
- Test strategy: `context/foundation/test-plan.md` (Risk #6, §2 Risk Response
  row #6, §3 Phase 3, §6.1)
- Functions to extract: `src/components/expenses/CategorySummary.tsx:38-78`
- Sibling harness/config: `context/changes/testing-rls-authorization/` +
  `vitest.config.ts`
- `src/lib` convention: `src/lib/format.ts:1-8`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when
> a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Extract compute to a pure module

#### Automated

- [x] 1.1 Type-check passes: `npx astro sync && npx tsc --noEmit` — 1e7f2f6
- [x] 1.2 Lint passes: `npm run lint` — 1e7f2f6
- [x] 1.3 Production build succeeds: `npm run build` — 1e7f2f6

#### Manual

- [x] 1.4 Dashboard renders identically (normal / first month / zero-expense) — 1e7f2f6

### Phase 2: Unit runner + Risk #6 suite

#### Automated

- [ ] 2.1 `npm test` runs both projects green (unit + integration)
- [x] 2.2 Unit suite runs green: `npx vitest run --project unit` — 42f72a3
- [x] 2.3 Lint passes: `npm run lint` — 42f72a3
- [x] 2.4 Type-check passes: `npx tsc --noEmit` — 42f72a3

#### Manual

- [x] 2.5 Flipping `>` to `>=` (or threshold to 0) makes a boundary test fail — 42f72a3
- [x] 2.6 Characterization file reads as labelled current-behavior documentation — 42f72a3

### Phase 3: Cookbook + test-plan wiring

#### Automated

- [x] 3.1 Docs format clean: `npm run format`

#### Manual

- [ ] 3.2 §6.1 reads as a usable unit-test recipe
- [ ] 3.3 §3 Phase 3 row reflects the shipped unit suite
