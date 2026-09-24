# 64 — Question Player

> Part of the [project memory](00_MASTER_CONTEXT.md). Source: `apps/web/src/components/QuestionPlayer.tsx`, `Timer.tsx`, `ResultScreen.tsx`, `apps/web/src/adapter/fixtures.ts`. Uncommitted.

## The fixture question bank — 4 questions, deliberately designed for a real repair loop

| id | Concept/family | Trap? | Role |
|---|---|---|---|
| `q-reverse-1` | Reverse Percentage, `base_confusion` | Yes | The "original" diagnosable wrong-answer question |
| `q-percentage-repair-1` | Same taxonomy cell + trap code as `q-reverse-1` | Yes | The repair follow-up question |
| `q-direct-1` | Direct Percentage | No | Adaptive/coverage pool |
| `q-combined-1` | Successive Percentage Change | No | Adaptive/coverage pool |

## A genuine domain-behavior discovery made while building this bank

The repair follow-up question was originally named `q-reverse-2`. Once a confirmed RepairPlan against `q-reverse-1` was built, `orchestrateNextTrainingAction()` recommended **`q-reverse-1` itself** back to the student — not a bug, but real, verified `@ipmat/repair-selection` behavior: `OVERUSE_MIN_ATTEMPT_COUNT` is **2**, so a single prior wrong attempt does not trigger overuse-avoidance, and both questions tied at "tier 1" (same taxonomy cell + trap code), so the final deterministic tie-break — lexicographically smallest `questionId` — picked `"q-reverse-1"` over `"q-reverse-2"` alphabetically.

**The fix was to the fixture data, never the algorithm**: the follow-up question was renamed to `q-percentage-repair-1`, which sorts before `q-reverse-1` lexicographically (`'p' < 'r'`). This is recorded here as a durable lesson: **do not hand-calculate expected repair-selection/adaptive-selection outcomes — verify against the real code**, exactly the same lesson Speed Lab's own progression-gate bug (see [32_SPEED_LAB.md](32_SPEED_LAB.md)) already taught during backend development.

## The Timer

A pure, presentational component (`Timer.tsx`) — the actual ticking `setInterval` lives in `QuestionPlayer.tsx`, which owns `elapsedSeconds` state and a `useRef` to read the current value at submit time without a re-render race. Visual feedback (`over-pace` class, color shift) triggers once `elapsedSeconds > expectedTimeSeconds`.

## Result + Solution

`ResultScreen.tsx` shows correct/incorrect, the student's answer, the correct answer (only if wrong), time taken vs. expected, and a toggle-able solution-steps list. Routes to either "See what the system noticed" (if `hasAutopsy`) or a plain "Continue" button.

## Verified end-to-end in this session's own adapter tests

- A correct answer never produces an autopsy.
- An incorrect answer on the trap question produces a real, confirmable hypothesis with non-empty `observed` facts.
- A non-trap question, even answered incorrectly, never surfaces an autopsy (the deliberate scoping decision — see [62_STUDENT_FLOWS.md](62_STUDENT_FLOWS.md)).
