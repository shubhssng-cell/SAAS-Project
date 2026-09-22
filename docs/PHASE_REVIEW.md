# Phase Review: Phases 1–3

**Audience:** an external senior architect deciding whether this implementation actually matches the product specification in [PRODUCT_SPEC.md](PRODUCT_SPEC.md), not a status report for stakeholders. Where something is untested against reality (no live database, no live AI provider), that is stated plainly rather than implied to work.

**Scope:** IPMAT Indore → Quant → Percentages only. Three phases: (1) data foundation + calendar-awareness, (2) concept intelligence + Examiner Lens, (3) AI provider + question generation + validation (proof of concept, not a content factory).

---

## 1. What was implemented

### Phase 1 — Foundation
- Full Prisma schema for the entire domain model described in [DATABASE.md](DATABASE.md) (not just the tables Phase 1 uses — Attempt/AttemptEvent/Autopsy/MasteryState exist, empty, with correct constraints, so Phase 4–5 don't need a schema redesign).
- `@ipmat/prep-phase`: `computePrepPhase()` / `applyCatchUp()` as pure functions, moved up from a planned Phase 6 because calendar-awareness is foundational, not a UI feature.
- `@ipmat/concept-graph` v1: a 7-concept Percentages neighborhood with a 3-type relationship model (`prerequisite_of` / `related_to` / `combines_with`).
- Seed data: IPMAT Indore exam catalog (14 Quant chapters), one internal test student/enrollment, an initial 5-entry `ErrorTaxonomy`.
- Migration `0001_init` generated via `prisma migrate diff --from-empty` (no live database available — see §9).

### Phase 2 — Concept Intelligence + Examiner Lens
- `@ipmat/concept-graph` rebuilt: 12 concepts across 8 chapters, an **8-type** relationship model (`prerequisite`, `foundational`, `directly_related`, `commonly_combined`, `application`, `dependent`, `advanced_extension`, `related_but_distinct`), every edge carrying `rationale`, `sharedKnowledge`, `usefulForQuestionGeneration`, `requirementLevel`, `certainty`. Added `ConceptDepth` (definition/intuition/formulas/methods/shortcuts/misconceptions/traps/application areas/difficulty progression), populated in full for Percentages and lightly for Ratio.
- New package `@ipmat/examiner-lens`: normalized `WhatIsTested`, a 10-value `TestingMode` vocabulary, live graph-derived combinations, error modes sharing `ErrorTaxonomy`'s 5-category vocabulary, dimensional difficulty (6 independent 0–1 axes), structural validation including a completeness-claim guard.
- New package `@ipmat/question-engine`: `QuestionPatternFamily` (structure) vs. `PatternTaxonomyCell` (concrete slice), a computed (never stored) coverage readiness ladder, `validateQuestionDna()`, one hand-authored demonstration question with full provenance.
- `Question` DNA finalized on the schema: `combinesWithConceptIds`, `noveltyLevel`, `examRelevance`, `testingModes[]`, `trapErrorTaxonomyId` (FK) replacing Phase 1's free-text placeholders.
- Migration `0002` generated via `prisma migrate diff` between the Phase 1 and Phase 2 schema snapshots (still no live database).

### Phase 3 — AI Provider + Question Generation + Validation
- New package `@ipmat/ai`: provider-agnostic `generateStructured()`, `FixtureProvider` (deterministic) and `AnthropicProvider` (real, unexercised), 4 Zod schemas, per-call metadata + cost estimation.
- New package `@ipmat/validation`: independent deterministic answer verification (`mathjs`, with an untrusted-input allowlist), independent-re-derivation comparison, 5 structural quality validators, token-overlap duplicate-risk check.
- `@ipmat/question-engine` extended: `QuestionBlueprint` (deterministic, no AI), `buildLensComparisonReport()` (human vs. AI Lens, never overwrites the baseline), `runGenerationPipeline()` (the full chain), the question lifecycle state machine.
- Three runnable demonstrations and 9 deterministic rejection-path fixtures.

**Total surface added across three phases:** 7 npm workspaces, ~90 source files, 92 unit tests, 2 Prisma migrations (neither applied to a live database).

---

## 2. Why each major architectural decision was made

This section explains *why*, not just *what* — see [DECISIONS.md](DECISIONS.md) for the full, dated log (D-001 through D-019). The decisions that most shape whether this matches the product spec:

- **Calendar-awareness moved from a planned Phase 6 into Phase 1** (D-009). The product spec treats "a September joiner should be in a different state than a December joiner" as foundational, not a UI nicety. Building the schema and pure functions first, UI later, means the hard part (the model) got validated before any pixel was drawn.
- **8 relationship types instead of 3** (D-013). The spec explicitly distinguishes prerequisite/foundational/application/etc. A 3-type model (`prerequisite_of`/`related_to`/`combines_with`) cannot represent "Ratio is required before Percentages" and "advanced Percentages problems sometimes need Ratio again" as two different, non-contradictory facts about the same pair of concepts. The 8-type model can, because direction + type together disambiguate them.
- **Examiner Lens combinations are computed, never stored** (D-015). This is the single most important integrity guarantee in the whole system: if "what can this combine with" were a cached column, it could silently disagree with the actual graph after an edge is added or corrected. Every other "coverage"/"readiness" number in the system (pattern-family coverage stage, mastery — not built yet) follows this same rule for the same reason.
- **`@ipmat/ai` has zero dependency on any domain package** (D-017). This was forced by a real circular-dependency problem (question-engine needs `AiProvider`; a naive design would have had `@ipmat/ai` import `QuestionDnaData` from question-engine, creating a cycle). The fix — restate the small controlled vocabularies as self-contained Zod schemas — also happens to be the architecturally correct answer at a trust boundary: what an LLM is allowed to produce should not silently change because an unrelated domain type got refactored.
- **Independent answer verification is two separate mechanisms, not one** (Phase 3 §5b in [QUESTION_ENGINE.md](QUESTION_ENGINE.md)): deterministic recomputation (mathjs) catches internally-wrong arithmetic; a second, blind AI call catches internally-consistent-but-wrong interpretation. Neither alone is sufficient — the rejection demonstration in §7 below shows a case the judge pass alone would have missed entirely.
- **Question lifecycle always gates Hard/Extreme/Novel through human review, regardless of validation cleanliness** (D-008, reaffirmed in Phase 3). This is a deliberate trust asymmetry: passing every automated check is necessary but not sufficient for the harder tiers, because that's precisely where automated checks are least proven.

---

## 3. Exact important files

```
packages/db/prisma/schema.prisma                                   — full domain model (678 lines)
packages/db/prisma/migrations/0001_init/migration.sql               — Phase 1 schema, never applied
packages/db/prisma/migrations/0002_concept_intelligence_and_examiner_lens/migration.sql  — Phase 2 diff, never applied
packages/db/prisma/seed.ts                                          — idempotent (upsert-based) seed script, never run

packages/domain/prep-phase/src/computePrepPhase.ts                  — calendar-phase pure function
packages/domain/prep-phase/src/applyCatchUp.ts                      — catch-up overlay pure function
packages/domain/prep-phase/src/curve.ts                             — phase-curve lookup logic

packages/domain/concept-graph/src/types.ts                          — the 8-type relationship model
packages/domain/concept-graph/src/graph.ts                          — graph query functions
packages/domain/concept-graph/src/depth.ts                          — ConceptDepth substructure types
packages/domain/concept-graph/fixtures/percentages.ts                — the seeded 12-concept/16-edge graph

packages/domain/examiner-lens/src/types.ts                          — TestingMode, ErrorCategory, DifficultyDimensions
packages/domain/examiner-lens/src/deriveCombinations.ts              — THE function that computes combinations from the graph
packages/domain/examiner-lens/src/validate.ts                       — structural validation + completeness-claim guard
packages/domain/examiner-lens/fixtures/percentagesLens.ts            — the human-authored Lens (evaluation baseline)

packages/domain/question-engine/src/coverage.ts                     — the readiness ladder (computed, not stored)
packages/domain/question-engine/src/questionDna.ts                   — validateQuestionDna()
packages/domain/question-engine/src/blueprint.ts                    — QuestionBlueprint + buildBlueprintFromCell()
packages/domain/question-engine/src/comparisonReport.ts             — human-vs-AI Lens comparison
packages/domain/question-engine/src/generationPipeline.ts           — the full generation chain
packages/domain/question-engine/src/lifecycle.ts                    — question status state machine
packages/domain/question-engine/src/prompts.ts                      — the actual prompt text sent to the model

packages/ai/src/generateStructured.ts                                — retry/timeout/backoff/validation orchestration
packages/ai/src/types.ts                                            — AiProvider interface, AiResultMetadata
packages/ai/src/providers/fixtureProvider.ts                        — deterministic test/demo provider
packages/ai/src/providers/anthropicProvider.ts                      — real provider (unexercised)
packages/ai/src/schemas/*.ts                                        — the 4 task schemas

packages/domain/validation/src/verifyComputation.ts                 — deterministic arithmetic re-derivation + security guard
packages/domain/validation/src/compareReverification.ts             — independent second-opinion comparison
packages/domain/validation/src/qualityValidators.ts                 — structural validators
packages/domain/validation/src/duplicateRisk.ts                     — token-overlap dedup heuristic
packages/domain/validation/src/judgeInterpretation.ts                — interprets AI-judge output

packages/domain/question-engine/demo/printGenerationDemo.ts          — runnable valid-path demonstration
packages/domain/question-engine/demo/printRejectionDemo.ts           — runnable rejection demonstration
packages/domain/question-engine/demo/printLensComparisonDemo.ts      — runnable human-vs-AI comparison
```

---

## 4. Important functions/classes and what they do

| Symbol | File | What it actually does |
|---|---|---|
| `computePrepPhase(input)` | prep-phase | Pure function: `(examId, enrollmentDate, today, template)` → expected coverage curve position + whether the student enrolled before the curve's own start. Takes NO mastery input by construction — the type signature has no field for it. |
| `applyCatchUp(phase, catchUpPlan)` | prep-phase | Pure function: layers a per-student overlay onto an already-computed phase. Never receives the `PrepPhaseTemplate` itself, so it structurally cannot mutate it. |
| `getCombinationCandidates(graph, name)` | concept-graph | Filters `ConceptRelation` edges to types `commonly_combined`/`application`/`dependent` AND `usefulForQuestionGeneration === true`. Explicitly excludes `related_but_distinct`. |
| `deriveCombinations(graph, name)` | examiner-lens | Thin wrapper over `getCombinationCandidates` that reshapes the result. **This is the only function allowed to answer "what can this combine with"** — no other code path should compute or cache this independently. |
| `findCompletenessClaims(text)` | examiner-lens | Case-insensitive substring match against a fixed list of 8 banned phrases ("every possible question", "mathematically complete", etc.). Returns the matched phrases, or `[]`. This is a blunt instrument — see §9. |
| `computePatternFamilyReadiness(name, cells, questions)` | question-engine | Given a family's cells and the questions referencing them, returns exactly one of `mapped`/`has_questions`/`validated`/`practice_ready`. Pure, deterministic, no caching. |
| `buildBlueprintFromCell(cell, family, options)` | question-engine | Deterministic transform: one `PatternTaxonomyCell` + its `QuestionPatternFamily` → one `QuestionBlueprint`. No AI call. Difficulty dimensions are derived from a hand-picked formula (see §8 — this is an assumption, not calibrated data). |
| `buildLensComparisonReport(human, ai, graph)` | question-engine | Diffs a human `ExaminerLensAnalysisData` against an AI `ExaminerLensAnalysisAiOutput`. Classifies every AI-proposed combination as `supportedByGraph` / `unsupportedByGraph` (invented) by checking for ANY edge between the two concepts, regardless of type. |
| `runGenerationPipeline(input)` | question-engine | The orchestrator: 1 blueprint → 3 AI calls (generation, reverification, judge) → 6 checks → 1 lifecycle status. Never throws on AI failure — converts it into a `rejected` result. |
| `computeLifecycleStatus({allChecksPassed, difficultyTier})` | question-engine | The ENTIRE publish-gating logic is this one function: any failed check → `rejected`; Hard/Extreme/Novel → `review_required` even if everything passed; otherwise → `validated`. |
| `generateStructured(provider, input)` | ai | The single choke point for every AI call. Retries on JSON-parse failure and schema-validation failure (feeding the error back into the prompt), retries on provider error with exponential backoff, times out, and returns `AiResultMetadata` alongside validated data — or throws `AiGenerationError` carrying that metadata. |
| `verifyComputation(input)` | validation | Rejects any `computation` string that fails a strict arithmetic-character allowlist BEFORE calling `mathjs.evaluate()`. Then compares the evaluated result to both `expectedAnswer` and (if parseable) `correctAnswer`, epsilon `1e-6`. |
| `compareReverification(input)` | validation | String-normalizes and compares the first candidate's answer to a second, independent model's answer. No arithmetic understanding at all — pure string comparison. |
| `validateCandidateStructurally(candidate, graph, blueprint, provenance)` | validation | Runs 5 sub-validators and merges their issues: blueprint compliance, syllabus compatibility, single-correct-answer, no-completeness-claim, provenance-present. |
| `checkDuplicateRisk(stem, existingStems)` | validation | Jaccard similarity over lowercased, punctuation-stripped, length>2 tokens. Threshold 0.6. This is intentionally crude — see §9. |

---

## 5. The actual database/schema changes

### Phase 1 → Phase 2 (migration `0002`)

The relationship-type enum was **replaced**, not extended:

```sql
-- AlterEnum
BEGIN;
CREATE TYPE "RelationType_new" AS ENUM ('prerequisite', 'foundational', 'directly_related', 'commonly_combined', 'application', 'dependent', 'advanced_extension', 'related_but_distinct');
ALTER TABLE "concept_relations" ALTER COLUMN "type" TYPE "RelationType_new" USING ("type"::text::"RelationType_new");
ALTER TYPE "RelationType" RENAME TO "RelationType_old";
ALTER TYPE "RelationType_new" RENAME TO "RelationType";
DROP TYPE "RelationType_old";
COMMIT;

-- AlterTable
ALTER TABLE "concept_relations" DROP COLUMN "strength",
ADD COLUMN     "certainty" "Certainty" NOT NULL,
ADD COLUMN     "rationale" TEXT NOT NULL,
ADD COLUMN     "requirement_level" "RequirementLevel" NOT NULL,
ADD COLUMN     "shared_knowledge" TEXT NOT NULL,
ADD COLUMN     "useful_for_question_generation" BOOLEAN NOT NULL;
```

`ConceptRelation.strength` (a 3-value weak/moderate/strong enum) is **gone**, not deprecated — replaced by 5 richer fields. This is safe only because no database has ever held a row in this table (confirmed — see §9); if this were a real production migration, `strength` → `requirementLevel`/`certainty` would need a backfill mapping, which does not exist.

`ExaminerLensAnalysis` was substantially reshaped:

```sql
ALTER TABLE "examiner_lens_analyses" DROP COLUMN "legitimate_patterns",
DROP COLUMN "novel_representations",
DROP COLUMN "prerequisites_exercised",
DROP COLUMN "transformations",
DROP COLUMN "valid_combinations",
DROP COLUMN "valid_traps",
DROP COLUMN "what_is_tested",
ADD COLUMN     "authored_by" "AuthorshipSource" NOT NULL DEFAULT 'human',
ADD COLUMN     "difficulty_dimensions" JSONB NOT NULL,
ADD COLUMN     "error_modes" JSONB NOT NULL,
ADD COLUMN     "testing_modes" "TestingMode"[],
ADD COLUMN     "what_is_tested_concept" TEXT NOT NULL,
ADD COLUMN     "what_is_tested_prerequisite_id" TEXT,
ADD COLUMN     "what_is_tested_skill" TEXT NOT NULL,
ADD COLUMN     "what_is_tested_subconcept" TEXT NOT NULL,
ALTER COLUMN "generated_by_provider" DROP NOT NULL,
ALTER COLUMN "prompt_version" DROP NOT NULL;
```

Notably, there is **no "combinations" column anywhere on this table** — by design (§2). Two new tables were added: `concept_depths` (1:1 with `concepts`) and `question_pattern_families` (FK'd from `pattern_taxonomy_cells.pattern_family_id`, which replaced the old free-text `pattern_name` column). `questions` gained `combines_with_concept_ids`, `novelty_level`, `exam_relevance`, `testing_modes[]`, and `trap_error_taxonomy_id` (replacing `trap_type`/`transformation`).

**Phase 3 made no schema changes at all.** `QuestionBlueprint` and `QuestionCandidateAiOutput` are pipeline-internal TypeScript types with no corresponding table — a candidate only becomes a `Question` row if/when it's actually persisted, which this phase's demonstrations do not do (they run entirely in memory).

### The one hand-written CHECK constraint

Prisma's schema DSL cannot express conditional NOT NULL, so this was added by hand to migration `0001`:

```sql
ALTER TABLE "questions" ADD CONSTRAINT "questions_published_requires_provenance"
  CHECK (validation_state <> 'published' OR provenance_id IS NOT NULL);
```

This is the only DB-level enforcement of "no publish without provenance" — everything else relies on application code (`validateQuestionDna`, `validateCandidateStructurally`) never constructing a published row without one. **The constraint has never been tested against a live database** (see §9).

---

## 6. Core algorithms / pseudocode

### 6.1 Phase curve lookup (`selectPhasePoint`)

```
selectPhasePoint(curve, daysRemaining):
  sorted = curve sorted descending by daysToExam
  eligible = [p in sorted where p.daysToExam >= daysRemaining]
  if eligible is non-empty:
    return last element of eligible   # smallest daysToExam among eligible = most recently crossed milestone
  else:
    return first element of sorted    # daysRemaining exceeds every milestone -> earliest defined phase
```
This is a step function, not interpolation — a student between two milestones is assigned the LOWER (earlier) milestone's expected coverage, i.e. the more conservative reading.

### 6.2 Pattern-family readiness ladder

```
computePatternFamilyReadiness(familyName, cells, questions):
  familyQuestions = questions where patternFamilyName == familyName
  validated  = familyQuestions where validationState in {ai_validated, human_reviewed, published}
  published  = familyQuestions where validationState == published

  if published is non-empty:   stage = practice_ready
  elif validated is non-empty: stage = validated
  elif familyQuestions non-empty: stage = has_questions
  else:                         stage = mapped
```
Strictly monotonic in one direction only per call — this function does not track history, it recomputes from current rows every time. There is no way for a family to "regress" except by the underlying data actually changing.

### 6.3 Lens comparison — invented-vs-missed relationship detection

```
buildLensComparisonReport(human, ai, graph):
  realCombinable   = { c.concept for c in deriveCombinations(graph, human.concept) }
  allRelated       = { neighbor for edge in getAllRelationsFor(graph, human.concept) }
  aiProposed       = [ s.concept for s in ai.suggestedCombinations ]

  supportedByGraph   = aiProposed ∩ allRelated        # AI happened to name a real edge (any type)
  unsupportedByGraph = aiProposed − allRelated         # AI invented a relationship with NO edge at all
  missedByAi         = realCombinable − aiProposed     # AI failed to mention a real, useful edge
```
Note the deliberate asymmetry: `supportedByGraph`/`unsupportedByGraph` check against **all** relationship types (any edge counts as "not invented"), while `missedByAi` checks against only the **useful-for-generation** subset (`commonly_combined`/`application`/`dependent`). This means an AI proposal matching a `related_but_distinct` edge (e.g. "Probability") would count as `supportedByGraph` even though that edge is explicitly *not* meant for combination — a subtlety worth re-checking if this report is ever used to auto-approve anything (it currently is not; it's read-only).

### 6.4 Generation pipeline (the core control flow)

```
runGenerationPipeline(blueprint, aiProvider, graph, existingStems, provenanceType):
  try:
    candidate, genMeta = generateStructured(aiProvider, task="question-generation", schema=questionCandidateAiSchema, ...)
  except AiGenerationError as e:
    return { status: rejected, candidate: null, reasons: [malformed_output] }   # never throws past this point

  structural   = validateCandidateStructurally(candidate, graph, blueprint, provenanceType)
  computation  = verifyComputation(candidate.groundTruthDerivation, candidate.correctAnswer)

  try:
    reDerived, reMeta = generateStructured(aiProvider, task="answer-reverification", userPrompt=candidate.stem, ...)
    reverification = compareReverification(candidate.correctAnswer, reDerived.derivedAnswer)
  except AiGenerationError as e:
    reverification = fail("call itself failed")   # a failed second opinion is treated as a failed check, not skipped

  duplicateRisk = checkDuplicateRisk(candidate.stem, existingStems)

  try:
    judgeOutput, judgeMeta = generateStructured(aiProvider, task="validation-judge", ...)
    judge = interpretJudgeVerdict(judgeOutput)
  except AiGenerationError as e:
    judge = fail("judge call itself failed")

  allPassed = structural.valid AND computation.valid AND reverification.valid AND duplicateRisk.valid AND judge.valid
  status = computeLifecycleStatus(allPassed, candidate.questionDna.difficultyTier)
  return { status, candidate, checks: {...}, rejectionReasons: flatten(all issues) }
```
Every check runs regardless of earlier failures — there is no short-circuiting. This is deliberate: the rejection demonstration (§7) shows a case where seeing ALL check results (not just the first failure) is exactly what makes the report useful ("the judge passed, but two independent arithmetic checks did not").

### 6.5 Independent answer verification, the actual guard

```
verifyComputation(computation, expectedAnswer, correctAnswer):
  if not SAFE_ARITHMETIC_PATTERN.matches(computation):     # only digits, whitespace, + - * / ^ ( ) . ,
    return fail(impossible_computation)                     # rejected WITHOUT ever calling evaluate()

  try:
    recomputed = mathjs.evaluate(computation)
  except:
    return fail(impossible_computation)

  if not isFinite(recomputed):
    return fail(impossible_computation)
  if abs(recomputed - expectedAnswer) > 1e-6:
    return fail(answer_mismatch)
  if correctAnswer parses as a number AND abs(recomputed - that number) > 1e-6:
    return fail(answer_mismatch)
  return ok()
```

---

## 7. Important code excerpts for the new intellectual/product logic

### 7.1 The 8-type relationship model (the core "concept universe" claim)

```ts
// packages/domain/concept-graph/src/types.ts
export type RelationType =
  | "prerequisite"       // target cannot be correctly understood without the source
  | "foundational"       // source is a broad numeracy/skill base under many concepts
  | "directly_related"   // share core reasoning mechanics; neither requires the other
  | "commonly_combined"  // frequently tested together within one question
  | "application"        // source's techniques applied within target's domain, no new theory
  | "dependent"          // advanced forms of target depend on source; basic form does not
  | "advanced_extension" // target generalizes/extends source with more machinery
  | "related_but_distinct"; // surface similarity, genuinely different rules

export interface ConceptRelationEdge {
  from: string; to: string; type: RelationType;
  rationale: string;                    // WHY — never a bare label
  sharedKnowledge: string;              // WHAT is actually shared
  usefulForQuestionGeneration: boolean; // combinable, or teaching-only?
  requirementLevel: "required" | "optional" | "contextual";
  certainty: "confirmed" | "probable" | "speculative";
  source: "human" | "ai_suggested";
}
```

A real seeded edge exercising the "honest uncertainty" requirement literally:

```ts
// packages/domain/concept-graph/fixtures/percentages.ts
{
  from: "Percentages", to: "Probability", type: "related_but_distinct",
  rationale: "Both are commonly expressed as numbers between 0 and 1 (or 0-100), and " +
    "'percentage chance' language invites students to apply percentage-arithmetic habits " +
    "(like direct addition) to probability, where the underlying rules (sample space, " +
    "independence) are entirely different.",
  usefulForQuestionGeneration: false,
  requirementLevel: "optional",
  certainty: "probable",   // <- NOT "confirmed" — this is a plausible pattern, not validated against real error data
  source: "human"
}
```

### 7.2 Combinations computed, never stored (the integrity guarantee)

```ts
// packages/domain/examiner-lens/src/deriveCombinations.ts
export function deriveCombinations(graph: ConceptGraph, conceptName: string): CombinationCandidate[] {
  return getCombinationCandidates(graph, conceptName).map((relation) => ({
    concept: relation.from === conceptName ? relation.to : relation.from,
    relation
  }));
}
```
There is no `ExaminerLensAnalysis.combinations` database column. Every consumer of "what can this combine with" calls this function against the live graph. A test in `examinerLens.test.ts` asserts the fixture's stored `combinations` field exactly equals a fresh call to this function — i.e. it proves the fixture *can't* have drifted, by construction, not just that it happens to match today.

### 7.3 The completeness-claim guard (enforcing "known/mapped/covered/uncovered, never complete")

```ts
// packages/domain/examiner-lens/src/validate.ts
const BANNED_COMPLETENESS_PHRASES = [
  "every possible question", "all possible questions", "complete coverage",
  "fully covers", "exhaustive list of", "every way this can be tested",
  "guaranteed to cover all", "mathematically complete"
];

export function findCompletenessClaims(text: string): string[] {
  const lower = text.toLowerCase();
  return BANNED_COMPLETENESS_PHRASES.filter((phrase) => lower.includes(phrase));
}
```
This is intentionally reused in THREE places: the Examiner Lens validator, the question-generation quality validator, and the human-vs-AI comparison report. **It is a literal substring match, not semantic understanding** — a completeness claim phrased any other way ("there's nothing else this topic can test") would pass silently. See §9.

### 7.4 The never-trust-the-answer verification (the most safety-critical code in the repo)

```ts
// packages/domain/validation/src/verifyComputation.ts
const SAFE_ARITHMETIC_PATTERN = /^[\d\s+\-*/^().,]+$/;

export function verifyComputation(input: {
  computation: string; expectedAnswer: number; correctAnswer: string;
}): ValidationResult {
  if (!SAFE_ARITHMETIC_PATTERN.test(input.computation)) {
    return fail("impossible_computation", "groundTruthDerivation.computation",
      "Computation contains characters outside plain arithmetic ... and was rejected without evaluation");
  }
  let recomputed: unknown;
  try {
    recomputed = evaluate(input.computation);   // mathjs — completely independent of the LLM
  } catch (error) {
    return fail("impossible_computation", ..., `Computation could not be evaluated: ${error}`);
  }
  if (typeof recomputed !== "number" || !Number.isFinite(recomputed)) {
    return fail("impossible_computation", ..., `did not evaluate to a finite number`);
  }
  if (Math.abs(recomputed - input.expectedAnswer) > EPSILON) {
    return fail("answer_mismatch", "groundTruthDerivation.expectedAnswer", ...);
  }
  const correctAnswerNumeric = parseNumeric(input.correctAnswer);
  if (correctAnswerNumeric !== null && Math.abs(recomputed - correctAnswerNumeric) > EPSILON) {
    return fail("answer_mismatch", "correctAnswer", ...);
  }
  return ok();
}
```
The allowlist check runs **before** the try/catch around `evaluate()` — a malicious or malformed computation string never reaches the expression parser at all, regardless of what mathjs itself would have done with it.

### 7.5 Publish-gating (the entire lifecycle decision in one function)

```ts
// packages/domain/question-engine/src/lifecycle.ts
export function requiresHumanReview(tier: DifficultyTier): boolean {
  return tier === "hard" || tier === "extreme" || tier === "novel";
}

export function computeLifecycleStatus(input: {
  allChecksPassed: boolean; difficultyTier: DifficultyTier;
}): QuestionLifecycleStatus {
  if (!input.allChecksPassed) return "rejected";
  return requiresHumanReview(input.difficultyTier) ? "review_required" : "validated";
}
```
This is genuinely the entire decision. There is no other code path anywhere in the repo that can set a status to `published` — `published` is only reachable via the `validated → published` or `approved → published` edges in `isValidTransition()`, and nothing in this phase calls either transition (no persistence layer wires this up to the `Question.validationState` column yet — see §11).

---

## 8. Assumptions made

These are places where a real decision was made without external validation, and a reviewer should know they exist:

1. **`Exam.exam_date_rule` is a single resolved date, not a real rule-to-date resolver.** Seeded as `{ type: "fixed_date", date: "2027-01-15" }`. There is no logic anywhere to handle a second exam cycle or a rule like "third Saturday of January." Fine for one cycle, wrong the moment a second cohort with a different exam date exists.
2. **Blueprint difficulty dimensions are a hand-picked formula, not calibrated data.** `buildBlueprintFromCell`'s `tierBaselineDimensions()` scales a baseline by `0.15 * tierIndex` per dimension. This number was chosen for plausibility, not derived from any real question's actual measured difficulty. It will produce a monotonically-increasing curve across tiers by construction, which may or may not match reality.
3. **The Percentages neighborhood graph (12 concepts, 16 edges) is a claim about IPMAT pedagogy that has not been reviewed by anyone with domain expertise in this session.** Every rationale is a plausible, self-consistent argument I constructed — not sourced from an actual IPMAT syllabus document, past papers, or a subject-matter expert. The one `certainty: probable` edge (Percentages↔Probability) is the only one honestly flagged as unverified; the other 15 are marked `confirmed`, which reflects "I reasoned this through carefully," not "a human exam-prep expert signed off on this."
4. **The 4 pattern families and 8 taxonomy cells for Percentages are illustrative, not a researched inventory of how IPMAT actually tests percentages.** They were designed to exercise the data model (all 8 relation types, multiple testing modes, several trap categories), not derived from past-paper analysis.
5. **The AI Examiner Lens output used for the comparison report (§4 of the Phase 3 report) is a hand-written fixture simulating a plausible AI response — not an actual model output.** No live call was made. The comparison LOGIC is real and would run identically against a genuine API response; the specific numbers reported (1 invented relationship, 3 missed) describe this fixture, not a real model's behavior.
6. **`correctAnswer` string parsing (`parseNumeric`) assumes a simple comma-separated numeral** (e.g. "10,240" or "480"). It has no support for fractions, currency symbols beyond stripping commas, ranges, or "approximately" phrasing. A candidate whose answer format doesn't match this assumption skips the `correctAnswer` cross-check silently (falls back to only checking `expectedAnswer`) rather than failing loudly — this is a real gap, not a deliberate design choice, and is called out again in §9.
7. **The token-overlap duplicate check's threshold (0.6 Jaccard similarity) is an arbitrary starting value**, not tuned against any real corpus of duplicate/non-duplicate question pairs (there is no such corpus yet — the whole question bank is 1–2 questions).
8. **No environment in this repository's history has ever had a live PostgreSQL connection or a live AI provider key.** Every claim about "the migration is correct" or "the pipeline works" is validated by (a) Prisma's own schema/migration validator, which checks SQL syntax and internal consistency but does not execute it, and (b) deterministic fixtures standing in for real provider responses. Neither is proof that a live run would succeed.

## 9. Known weaknesses

**Update (Phase 3.1 — see [PHASE_3_1_REVIEW.md](PHASE_3_1_REVIEW.md)):** items 6 and 7 below are now fixed; item 5's trust boundary was tightened (the judge no longer sees the claimed answer/explanation at all, reducing anchoring risk) but the underlying limitation — no deterministic fallback if the judge itself is bad at the task — still holds, unchanged. Items 1, 2, 3, 4, 8, 9, 10 are unchanged by Phase 3.1. Two NEW weaknesses were introduced/discovered by Phase 3.1 and are appended at the end of this list.

Ranked roughly by how much they matter if this were to ship as-is:

1. **Zero end-to-end validation against a real database.** Two migrations exist, both schema-valid per `prisma validate`, neither ever applied. Foreign key behavior, cascade deletes, the one hand-written CHECK constraint, and every unique index have been reasoned about but never exercised against actual Postgres. A migration that is syntactically valid can still fail on `migrate deploy` for reasons Prisma's static validator cannot catch (e.g. an unexpected existing row, a lock timeout, an extension not installed).
2. **Zero end-to-end validation against a real AI provider.** Every "the pipeline works" claim is `FixtureProvider`-based. A real model might: return a `computation` field with an operator this project's allowlist doesn't recognize (e.g. `sqrt()`, `%`), refuse to echo `blueprintId` correctly, wrap JSON in explanatory prose the current fence-stripping doesn't catch, or simply produce lower-quality output than the hand-crafted fixtures assume. None of this has been observed.
3. **The completeness-claim guard is a literal substring list.** It catches "every possible question" but not "there's nothing this method can't handle" or "this is the only approach you'll ever need." A model motivated to sound confident (which base RLHF training tends to produce) could trivially phrase around this list. It is a tripwire for the obvious case, not a semantic detector.
4. **Duplicate detection cannot catch a paraphrase.** Token-overlap similarity requires shared vocabulary. "A shop increased a jacket's price by 25%..." and "A retailer raised a coat's cost by a quarter..." describe the identical question and would very likely score below the 0.6 threshold. This is explicitly documented (D-019) but worth restating: **it does not do what "duplicate detection" sounds like it does.**
5. **Ambiguity/contradiction detection has no fallback if the judge model itself is bad at the task.** There is no deterministic check standing behind `validation-judge` — if that one AI call systematically under-detects ambiguity (plausible; LLM self-judgment is a known weak point), nothing else in the pipeline would catch it. The rejection demonstration deliberately shows a case where the judge is *supposed* to pass (nothing ambiguous) — but there's no fixture proving the judge would correctly *fail* a genuinely ambiguous question, only that the interpretation function correctly propagates a judge failure when one is given.
6. ~~**`correctAnswer` numeric parsing is fragile** (§8.6) — a candidate with a non-numeric or oddly-formatted answer silently skips part of the cross-check rather than failing closed.~~ **FIXED in Phase 3.1** (docs/DECISIONS.md D-024): now fails closed with `unverifiable_answer`; the `Number("")===0` coercion bug is also fixed.
7. ~~**The Lens comparison's `supportedByGraph` check is type-blind** (§6.3) — it would count a match against a `related_but_distinct` edge as "supported," which arguably it should not be, since that edge type exists specifically to say "don't combine these."~~ **FIXED in Phase 3.1** (docs/DECISIONS.md D-023): now 4 categories, `related_but_distinct` matches land in `relatedButNonCombinable`, not `validGenerationCombination`.
8. **No concurrency/idempotency testing on the seed script beyond "upsert exists."** It has never been run twice against a real database to confirm the idempotency claim holds under real constraint violations (e.g. a partially-completed prior run).
9. **Single demonstration question per phase.** Phase 2 has exactly one hand-authored, fully-worked question. Phase 3 has exactly one AI-attempted blueprint (via fixture). Neither constitutes evidence that the approach scales past a hand-picked favorable example. Phase 3.1 did not change this — it hardened the pipeline's rules, it did not run it against more inputs.
10. **`@ipmat/ai`'s hand-maintained cost table will silently go stale** — there is no test or mechanism that would catch Anthropic changing prices; `estimateCostUsd` would keep returning confidently wrong numbers for a recognized model rather than flagging staleness.
11. **NEW (Phase 3.1): the independent-verifier leakage fix and blueprint-compliance expansion are proven only structurally, not behaviorally against a real model.** The tests prove the TYPE cannot carry the answer and that the PROMPT TEXT doesn't contain it — they cannot prove a real model won't guess correctly anyway some fraction of the time by chance, which would look identical to "independent verification passed" without actually being independent evidence. This is an inherent limitation of testing independence with a deterministic fixture instead of a real second opinion.
12. **NEW (Phase 3.1): the budget circuit breaker only checks cost AFTER each call completes, not before.** `runGenerationPipeline()` can still make one call that itself exceeds the entire budget (proven directly in the test — a single call reports ~$180 against a $1 budget) before the breaker trips for the NEXT call. It bounds total spend to "worst case one full over-budget call," not "never exceed budget" — acceptable for a 3-call pipeline processing one blueprint, but would need a pre-flight cost estimate (not built) to bound a true batch loop.

## 10. Tests and what they actually prove

**118 tests pass (92 through Phase 3, +26 in Phase 3.1). Here is what that does and does not mean.**

| What the tests prove | What they do NOT prove |
|---|---|
| `computePrepPhase`/`applyCatchUp` are pure, never read mastery-shaped data even when it's smuggled into the input object, and never mutate their inputs. | That the phase curve itself (the specific milestone values) reflects a realistic IPMAT preparation timeline. That's authored data, not logic, and nothing checks it against reality. |
| The concept graph fixture uses all 8 relationship types with directional correctness, and every edge has non-trivial `rationale`/`sharedKnowledge` text. | That the *content* of any rationale is pedagogically correct. A test checking `rationale.length > 20` proves a sentence exists, not that it's true. |
| `deriveCombinations()` output exactly matches what `getCombinationCandidates()` computes fresh, and the stored Lens fixture's `combinations` field matches a fresh call — i.e., no drift is possible by construction. | That the *set* of combinable concepts is the pedagogically right set. |
| `findCompletenessClaims()` catches every phrase in its own list, and a deliberately-injected claim ("every possible question") is caught by the full validation chain. | That it catches paraphrased completeness claims (§9.3) — the test suite only exercises phrases already in the banned list, which is circular by construction. |
| `computePatternFamilyReadiness` correctly classifies mapped/has_questions/validated/practice_ready given synthetic `Question`-shaped inputs with various `validationState` values. | That real generated questions will actually reach `validated`/`practice_ready` at any particular rate — the test fixtures are hand-picked to hit each branch, not sampled from real generation attempts. |
| `generateStructured()` retries on malformed JSON, retries on schema-validation failure with the error fed back into the prompt, times out a hung provider, and throws `AiGenerationError` with correct metadata after exhausting retries — all verified with `FixtureProvider`, which returns exactly the string it's told to. | That a REAL model, given the retry-feedback prompt, will actually self-correct. `FixtureProvider` cannot simulate a model that keeps making the same mistake, or one whose second attempt is worse than its first. |
| `verifyComputation()` rejects a computation string containing `constructor.constructor(...)` (a prototype-pollution-style payload) via the allowlist, without ever calling `evaluate()`. | That the allowlist is exhaustively safe against every conceivable injection technique — it proves this one specific attack pattern is blocked, not that the regex is provably complete. |
| `runGenerationPipeline` correctly computes `rejected` when a candidate's stated answer disagrees with its own computation AND a second independent call agrees with the computation, not the stated answer — and correctly computes `review_required` (not `validated`) for a Hard-tier candidate that passes everything. | That this control flow, run against REAL AI responses (which can fail in ways fixtures cannot — see §9.2), behaves the same way. Every AI response in every pipeline test is a fixed string chosen by the test author to hit a specific branch. |
| The full valid-path and rejection-path demonstrations run end-to-end and print a coherent, correct report. | That the reports are correct for any input other than the two specific scenarios constructed for them. |
| **(Phase 3.1)** `toPresentedQuestionView`/`toJudgeView` return an object with EXACTLY the allowed keys (checked by set equality), and prompts built from marker-planted candidate fixtures never contain the planted secrets. | That a real model, given the resulting prompt, cannot happen to guess correctly by chance — see weakness §9.11. The proof is structural (the type/prompt cannot carry the value), not behavioral (a real independent opinion was actually formed). |
| **(Phase 3.1)** `validateGenerationLimits` rejects every individually-invalid limit and lists all violations at once; the budget circuit breaker correctly skips the 2nd and 3rd AI calls (with `metadata: null`) when a mock provider reports ~$180 in estimated cost against the $1 default budget. | That the budget check prevents overspend in general — it only stops calls AFTER the one that blew the budget already ran; see weakness §9.12. |
| **(Phase 3.1)** Five new blueprint-violation fixtures (difficulty tier, testing mode, trap, combination-concept, plus the original pattern-family case) each trigger a distinct `blueprint_violation` issue with the correct `field` value. | That these are the ONLY ways a candidate could drift from its blueprint — only the fields the schema actually has were checked; a field not yet in `QuestionCandidateAiOutput`'s schema has nothing to check. |

**The general pattern across this entire test suite: it proves the deterministic control flow, type contracts, and data-integrity invariants are correct given the inputs tested. It does not and cannot prove that real AI providers will produce inputs shaped like the ones tested, or that the authored domain content (concept graph, pattern families, phase curve) is pedagogically accurate.** Those are different kinds of claims, and passing tests only supports the first kind.

## 11. What is NOT yet implemented

Stated plainly, not just as a phase-plan footnote:

- **No live database has ever been created, migrated, or queried.** Both migrations are unapplied SQL files.
- **No live AI provider call has ever been made.** `AnthropicProvider` exists as code and has never executed. Phase 3.1 wrote a real-provider smoke-test script (`npm run smoke:anthropic --workspace @ipmat/question-engine`) ready to run — see [PHASE_3_1_REVIEW.md](PHASE_3_1_REVIEW.md) for why it wasn't run this pass.
- **No question has ever been persisted as a `Question` row via the generation pipeline** — `runGenerationPipeline()` returns an in-memory result; nothing writes it to a database, because there is no database connection to write to.
- **7 of 8 seeded Percentages taxonomy cells have zero questions**, generated or hand-authored.
- **No background job/queue system** — `runGenerationPipeline()` is a plain async function called directly.
- **No student-facing anything** — no UI, no API route, no auth flow beyond a single seeded internal test user.
- **No Attempt/Autopsy/Mastery logic** — those tables exist in the schema (empty) but no code reads or writes them.
- **No real embedding-based duplicate detection**, no real cost-aggregation/logging job (only per-call metadata), no admin UI for reviewing `review_required` questions (the state exists; nothing surfaces it to a human).
- **No calendar-phase UI** — `computePrepPhase`/`applyCatchUp` are called only from unit tests.
- **No second exam, section, or chapter has real content** — only Percentages has pattern families, taxonomy cells, or a Lens analysis; the other 13 seeded Quant chapters are catalog rows with no concept graph depth.

