# Product Phase 0 — Product Definition

Status: this phase is documentation only — a definition, not a build. It captures the product definition as already represented in the repository's existing documentation ([../PRODUCT_SPEC.md](../PRODUCT_SPEC.md), CLAUDE.md's non-negotiable product rules) and conversation context, reframed under the new product-roadmap numbering. It does not introduce new product claims beyond what's already documented.

## 1. Product

An AI-native, adaptive practice platform for IPMAT (Indian competitive exam) preparation. The repository currently builds exactly one vertical slice end to end: IPMAT → Quant → Percentages.

## 2. Primary user

A self-driven IPMAT aspirant preparing independently — not a classroom cohort, not a coaching-org administrator, not a parent.

## 3. Core problem

Students need a better way to decide what to practice next, and to turn practice performance into useful next actions — rather than grinding undifferentiated question volume or guessing at their own weaknesses.

## 4. Flagship capability

Adaptive Practice: recommending the next right thing to practice based on observable evidence (accuracy, speed, retries, hints, time-vs-expected — never a confidence score, per D-005), not a fixed syllabus march.

## 5. Initial student journey

```
Landing
  -> Sign up / Login
  -> Onboarding
  -> IPMAT enrollment
  -> Dashboard
  -> Start Practice
  -> Practice experience
```

## 6. Product philosophy

- Syllabus completion is not mastery.
- Question volume is not coverage.
- Familiarity is not understanding.
- Hard is not automatically useful.
- Mistakes are data.
- Time is important evidence.
- The system must rely on observable evidence, never inferred mental/emotional state (this is the product-level statement of D-005/D-034/D-038's "no confidence score, ever" rule).
- UI should stay simpler than the backend — the frontend surfaces decisions already made by the domain/application layers, it never re-implements them (this is the product-level statement of the architecture rule below).

## 7. Initial scope philosophy

Build the platform first, then the real practice loop, then deeper intelligence. Concretely: Product Phase 1 (Platform Shell) before Product Phase 2 (Real Practice Loop) before Product Phase 3+ (Adaptive Practice, Autopsy, Training Systems, ...). See [00_PRODUCT_ROADMAP.md](00_PRODUCT_ROADMAP.md) for the full phase list.

## 8. Explicitly out of scope for the initial product

- General-purpose AI chatbot
- Voice tutor
- Parent platform / secondary-account model
- Community / social network features (leaderboards, sharing, cohorts)
- Multi-exam expansion
- Native mobile apps
- B2B coaching platform / multi-tenant coaching-org accounts
- Payments as the first product feature
- A giant mock-test ecosystem
- Unnecessary platform complexity (plugin systems, config layers for exams/chapters that don't exist yet)

This list is consistent with, and does not relax, the existing engineering-side exclusions already documented in [../MASTER_PLAN.md](../MASTER_PLAN.md) §"What should explicitly NOT be built yet".

## 9. Product validation idea

The first meaningful question this product needs to answer is whether students find real value in a system that helps them determine what they should practice next — not whether the platform is feature-complete. Everything in Product Phase 1–2 exists to make that question answerable with a real student, not a fixture.

## Sources

This definition is drawn from:
- [../PRODUCT_SPEC.md](../PRODUCT_SPEC.md) (existing product vision)
- CLAUDE.md's non-negotiable product rules and working-style section (checked into the repo root)
- [../MASTER_PLAN.md](../MASTER_PLAN.md)'s "Current state", "What should explicitly NOT be built yet", and "Explicit go/no-go gate before starting chapter two" sections
- The product-roadmap-reset instruction that initiated this documentation pass (2026-09-29)

No numbers, market claims, or user counts are asserted anywhere in this file — none exist yet, and none are fabricated here.
