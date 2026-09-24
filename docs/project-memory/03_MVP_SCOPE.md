# 03 — MVP Scope (the scope firewall)

> Part of the [project memory](00_MASTER_CONTEXT.md). Source: `docs/MASTER_PLAN.md` "What should explicitly NOT be built yet" and "Explicit go/no-go gate before starting chapter two", `docs/PRODUCT_SPEC.md` §6, `CLAUDE.md`. **Do not silently expand this scope.** If a request falls in the excluded list, flag it back rather than quietly building it.

## The one vertical slice (in scope, and the only thing being built)

```
IPMAT → Quant → Percentages
  → Concept Universe → Examiner Lens → Question Universe → Question DNA
  → Question Generation → Validation
  → Student Attempt → Question Autopsy → Targeted Repair → Mastery
```

Every architectural decision is judged by: does it make this slice work end-to-end for **one exam, one subject, one chapter, one concept**, in a shape that generalizes later without redesign?

## Explicitly IN scope and built (see [92_CURRENT_STATE.md](92_CURRENT_STATE.md) for exact current status of each)

- Full Prisma schema for the entire domain model (including tables not yet used by application code)
- Concept Universe: 12 concepts, 16 relationships, 8 relationship types, for Percentages and its graph neighbors
- Examiner Lens: structured analysis, human baseline + AI comparison report
- Question Universe: pattern families, taxonomy cells, coverage ladder
- Question DNA: fully normalized on every `Question` row
- AI provider abstraction, 5 task types, full generation pipeline with independent verification
- Attempt lifecycle state machine, canonical event vocabulary
- Question Autopsy: OBSERVATION → EVIDENCE → HYPOTHESIS → CONFIRMED DIAGNOSIS, all four layers
- Mastery: multidimensional, nullable, never composite
- Targeted repair selection (one confirmed diagnosis → one question)
- Global adaptive selection (deterministic core)
- Training orchestration coordinating both plus five concrete training-system providers (Calculation Gym, Speed Lab, Trap Lab, Novelty Training, Pressure Training)
- Practice Session / Practice Block general infrastructure
- Persistence adapters for Attempt, Autopsy, RepairPlan, MasteryState, PracticeSession, PracticeBlock, Question publication/import
- An internal Training Playground (`apps/training-playground`) for inspecting real domain behavior
- A first vertical-slice student-facing UI (`apps/web`, uncommitted, fixture-backed) — see [92_CURRENT_STATE.md](92_CURRENT_STATE.md)

## Explicitly NOT in scope yet (verbatim, from `docs/MASTER_PLAN.md`)

- **Payments, subscriptions, or any pricing logic**
- **Parent portal or any secondary-account model**
- **Full question-bank buildout for any exam other than IPMAT, any section other than Quant, or any chapter other than Percentages.** This does NOT mean the concept graph must pretend other chapters don't exist — Phase 2 deliberately reaches into Ratio, Averages, Profit and Loss, Data Interpretation, Algebra, and others as *neighbors in Percentages' graph*, each with a real chapter row and a real relationship. The restriction is on building those chapters out as first-class content targets, not on acknowledging they exist.
- **Massive/automated question-generation batches, thousands of questions, or automated publishing.**
- **A full BullMQ job queue/worker system for AI generation** — the pipeline is a plain async function today; a future queue wraps it without changing its signature.
- **Social features** (leaderboards, sharing, cohorts)
- **SEO/marketing site**
- **Mock-test assembly engine or a large pre-built mock library**
- **Vocabulary Gym**
- **Surprise Mode as a named/UI-facing feature**
- **Multi-tenant / coaching-org accounts**
- **Automated fine-tuning of any AI prompt from autopsy correction data** (manual review only, for now)
- **A polished admin UI** — internal tooling can be CLI scripts or bare pages
- **A full coaching-material ingestion pipeline or general-purpose AI chatbot**

## Pressure Training — a scope item that moved, tracked precisely

Pressure Training was originally deferred (D-059) for lack of a prerequisite (a Practice Session/Block abstraction). That prerequisite was built (D-060), Pressure Training itself was designed and implemented (D-061), and it was wired into orchestration (D-062). **It is no longer in the "not built yet" list.** What remains NOT built for it, specifically: any UI, any HTTP/API route, or a real caller that assembles its `practiceBlocks` evidence from persisted data (see [37_TRAINING_RECOMMENDATION.md](37_TRAINING_RECOMMENDATION.md)).

## Mock Simulation — deliberately shaped for later, not built

The generic `practiceBlocks`/`training_system_practice` shapes (D-061/D-062) were deliberately kept provider-agnostic partly so a future Mock Simulation system could reuse them — but Mock Simulation itself remains entirely undesigned. Do not treat the existence of these generic shapes as an invitation to start designing Mock now.

## The explicit go/no-go gate before starting chapter two (verbatim)

> "Do not start a second chapter until: the Percentages taxonomy has real coverage above a self-chosen threshold, the validation pipeline's rejection rate is low enough that it isn't a full-time babysitting job, and at least one real student has completed the full loop (practice → wrong answer → autopsy → repair → improved subsequent attempt) at least once. If any of those isn't true, the fix is to fix the slice, not to add breadth."

As of the current checkpoint (see [92_CURRENT_STATE.md](92_CURRENT_STATE.md)), **none of these three conditions has been met**: 0 questions are `published`, no real AI validation has occurred, and no student (real or internal tester) has completed the full loop against a live database. This gate has not been reached.

## Dependencies and prerequisites between scope items

```
Published questions (Phase 3.5, still 0)
  └─requires→ human publication review (infra exists, D-049; never invoked)
       └─requires→ a real publish/reject decision by an authorized human

Practice UI / HTTP API (Phase 4B-3+)
  └─requires→ published questions AND a reachable live database (neither exists)

Training Recommendation Composition (next architectural unit)
  └─requires→ several new @ipmat/db repository methods (see 37_TRAINING_RECOMMENDATION.md)
  └─does NOT require→ published questions specifically, but is meaningless in production without them

Real AI-validated content
  └─requires→ an ANTHROPIC_API_KEY (never configured in this environment, deferral explicit, not revisited)
```

## What "launch requirements" would mean (reconstructed context — not specified anywhere in the repository)

*The repository's own docs never define a "launch" milestone explicitly — `docs/MASTER_PLAN.md` speaks only in terms of phases and the go/no-go gate above. Based on that gate plus the explicit NOT-yet-built list, a minimal, honest reading of "ready to let a real external student in" would require at minimum: a reachable live database, at least one real `ANTHROPIC_API_KEY`-validated and human-published question, a working HTTP/API + UI practice loop, and the go/no-go gate's three conditions. This is inference, not a documented target — do not treat it as an approved plan.*
