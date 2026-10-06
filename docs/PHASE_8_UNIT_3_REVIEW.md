# Phase 8 Unit 3 — AI Question Generation

Decision record: [DECISIONS.md D-094](DECISIONS.md). Code: `packages/domain/question-generation` (`@ipmat/question-generation`, pure) plus three small additive changes to `@ipmat/question-engine`'s existing pipeline. **No migration, no table, no route, no UI, no second provider, no second duplicate system, no publish path.**

## 1. Specification audit

**A. Explicitly specified (and reused unchanged):**
- **The Phase 3 generation pipeline** (`runGenerationPipeline`, D-008/D-020/D-022/D-024–D-031): a blueprint built from an existing taxonomy cell → one generation call → structural + blueprint-compliance validation → independent deterministic recomputation (`verifyComputation`) → a second, independent AI re-derivation that never sees the first answer → token-overlap duplicate screen → an independent judge that sees only a `JudgeView` → a lifecycle status. Hard/Extreme/Novel never reach `validated`; an unpriced model is refused before any call; limits/budget are validated before any call.
- **Content authoring** (D-084): an AI proposal is a **draft** with `origin: "ai_generated"`; the lifecycle is the existing `ValidationState`; 11 gates (`structure, metadata, dna, concept, pattern, difficulty_novelty, expected_time, answer, identity, provenance, review`); an AI answer is never trusted on the generator's word (it needs an independent re-derivation or a reviewer); AI content must reference its generation record; an exact duplicate IS the same question; a near-duplicate needs a human and is never merged; `publishQuestion` is the only path to `published`; authoring needs an EXISTING taxonomy cell.
- **Historical intelligence is observed evidence, not prediction** (D-083); **rights** (D-085); **no completeness claims** (D-007); **difficulty is provisional** (D-021).

**B. Safely composable (implemented):** a deterministic generation spec from an existing cell; mapping a pipeline candidate to an authoring draft; reusing the pipeline's second-call re-derivation as the authoring gate's independent check; exam-scoped identity references; a batch over the existing generation limits; a metadata-only trace.

**C. Not specified (not invented; carried in §10):** which cells/tiers/novelty levels to generate and in what priority; reviewer workflow/queue and SLAs; a calibrated notion of difficulty (all dimensions stay provisional); **source-backed generation** (no rule says how authorized source text may become a question, so it is unsupported); how historical records may steer generation (not consumed — see below); a pedagogical-quality rubric; a durable generation-trace store; production batch sizes and budgets; semantic duplicate detection; the editorial assignment of `examRelevance`.

## 2. Architecture

```
GenerationSpec (blueprint + noveltyLevel + examRelevance, deterministic specId)
  -> validateGenerationSpec     (existing DNA validator + family-space rules; NO model call if invalid)
  -> runGenerationPipeline      (EXISTING Phase 3 pipeline, any @ipmat/ai provider)
  -> spec compliance            (novelty, relevance, answer format, >= 2 options)
  -> proposeAiQuestion + createDraft   (existing authoring lifecycle; exact duplicate refused)
  -> authoring.validate         (EXISTING 11 gates; draft -> ai_validated iff no gate FAILED)
  -> trace (metadata only) + optional sink
  ...  review / publish only through ContentAuthoringService, outside this package
```

The service exposes `generateOne` and `generateBatch` only. It imports no vendor, no Prisma, no content-intelligence (so no source text can enter), and contains no publish call (boundary-tested).

## 3. Generation specification

`GenerationSpec` reuses the existing `QuestionBlueprint` (exam, section, chapter, concept, pattern family, skill, prerequisites, combination concepts, difficulty tier + provisional dimensions, expected time, transformation note, trap, testing modes, answer format) and adds only the two Question-DNA fields a blueprint lacks: `noveltyLevel` and `examRelevance` (an editorial label). `provenanceSourceType` is `"original"` only. The `specId` is a hash of the canonical form (sorted keys; combination concepts as a set) and is recomputed on validation (a tampered spec is refused). `buildGenerationSpec` builds one from an existing cell through `buildBlueprintFromCell`; `planSpecsForUncoveredCells` plans specs only for cells the existing `computeTaxonomyCellCoverage` reports as `uncovered` — a plan over what is **mapped**, never a claim of completeness or importance.

Validation (no model, never throws): exam pack exists and is valid (fail closed); the existing DNA classification validator (section/chapter/concept/pattern/tier/novelty/time/modes/trap vocabulary); pattern family belongs to the concept; trap, testing modes and combination concepts lie inside the family's documented space; calibration must be `provisional`; transformation text length/control characters; answer format; source-backed provenance refused.

## 4. Provider architecture

Reuses `@ipmat/ai` `AiProvider` + `generateStructured` via the existing pipeline; there is no second abstraction (boundary-tested). The package names no vendor, reads no environment and holds no key. A new provider only needs a price entry in the existing cost table (an unpriced model fails closed before any call). Tests use a deterministic double; no live model has run.

## 5. Model-output contract

The existing `questionCandidateAiSchema` (strict shape, extra keys stripped). Only **content** flows into the draft: stem, options, answer, solution steps and the derivation. The model's `reasoning`, `explanation`, claimed DNA, blueprint echo and any extra field are dropped; nothing the model said about the question's metadata is recorded — **the spec's DNA is recorded**, after compliance proved the model's claim agrees. (The existing schema obliges the model to return a `reasoning` string; it is never stored. Removing that field is a possible later change to the Phase 3 schema.)

## 6. Question DNA enforcement and difficulty/novelty

The existing blueprint-compliance check rejects drift in concept, pattern family, difficulty tier, required testing modes, trap and exact combination set; Unit 3 adds novelty, relevance and answer-format compliance. Drift ⇒ stored as `rejected` with the reasons traced; recorded DNA is read back from the repository and compared with the request (`dnaDifferences`, empty by construction). Difficulty is the **spec's**, never the model's word: a model claiming "extreme" on an advanced spec is rejected; dimensions stay `provisional`; Hard/Extreme/Novel are `review_required` and the `review` gate keeps them from publication without a named reviewer. Novelty is requested and checked, never inferred from wording; identity against the existing universe is the existing exact/near-duplicate system.

## 7. Validation, duplicates, answers

- **Blocking (candidate → `rejected`):** structural, recomputation, independent re-derivation, judge, spec compliance. **Not blocking:** the pipeline's near-duplicate screen — near-duplicates go to the authoring `identity` gate (`requires_human`), never merged.
- **Authoring gates:** every stored candidate is evaluated by the existing 11 gates; a failed gate leaves it `draft`. There is no generation-only weaker path.
- **Exact duplicate:** nothing stored, the existing question is untouched and named; across exams an identical wording is *not* a duplicate. A rejected row never blocks the same wording (the new candidate takes a numbered id — found by the real-Postgres test).
- **Answer:** deterministic recomputation where a derivation exists (all pipeline candidates carry one); the stored candidate carries the **second** call's answer as its independent check; removing it re-opens the `answer` gate for a human. For anything not derivable the existing gate requires a reviewer. No answer is trusted on the model's word, and nothing here proves pedagogical quality.

## 8. Provenance, rights, review

`origin: "ai_generated"`, `sourceType: "original"`, `sourceRef: "ai-generation:<traceId>"` (the existing gate requires a generation reference). No external source text exists anywhere in the flow; source-backed generation is refused at spec validation. Historical evidence is **not consumed** (no rule says how it may steer generation without predictive framing). Human review: nothing is promoted automatically; `ai_validated` is the furthest the engine goes, and publication is an explicit `ContentAuthoringService.publish` call that re-evaluates every gate. The trace states `reviewRequired` with reasons.

## 9. Auditability

`GenerationTrace` answers: which spec; which provider/model/prompt versions; token/cost metadata per call; each pipeline check and its codes; DNA requested vs the model's claim vs recorded; exact/near-duplicate outcome; provenance; every gate status; whether review is required and why; whether it is publishable and, if not, why. It holds **no prompt, response text, reasoning or credential** (tested). Traces go to an optional sink (in-memory implementation provided); a sink failure never changes the outcome.

## 10. Unresolved generation policies

Which cells/tiers/novelty levels to generate and in what order; reviewer workflow; calibrated difficulty; source-backed generation and the rights basis for it; whether/how historical records steer generation; a pedagogical-quality rubric and who judges it; durable trace storage (needs a product decision on a store); production batch sizes/budgets; semantic duplicate detection; assignment of `examRelevance`; whether the one-option guard should live in the authoring `structure` gate; whether the model's mandatory `reasoning` field should be removed from the Phase 3 schema.

## 11. Known limitations

- Duplicate detection is token overlap, not semantic (unchanged); a paraphrase can pass.
- Only Percentages pattern families/cells exist, so only those can be generated.
- The authoring `structure` gate accepts a one-option "multiple choice"; generation refuses it (minimum two — no larger count is invented).
- Traces are not durable; the stored candidate keeps only the generation reference.
- A live provider has never been run (no key); the pipeline is proven on deterministic doubles.
- Structural validity is not quality: a valid, correct question can still be a poor question; human review is the only quality control.

## 12. Verification

| Check | Result |
|---|---|
| Focused generation tests (`@ipmat/question-generation`) | 4 files, 94 tests passed: spec 34, generation 50, properties 6, boundary 4 |
| Real-Postgres generation integration | 8 tests passed (persisted `ai_generated` candidate, DNA read-back, duplicate, rejection + regeneration, review gate, student boundary, no generation table) |
| Existing authoring / question-engine regression | content-authoring + question-engine: 638 tests passed after the additive pipeline changes; authoring Postgres integration 24 passed |
| Mutation checks | disabling spec compliance made 4 tests fail; restored |
| Full suite, real Postgres 16 (disposable, `127.0.0.1:55432`, 5432 untouched, migrations 0001-0016 + seed) | 316 files, 7341 tests passed |
| Full suite, no Postgres | 294 files passed, 22 skipped (DB-only); 7070 tests passed, 271 skipped |
| Typecheck / lint / build | all clean (lint caught 6 issues in the new files, fixed) |
| `git diff --check` | clean |
| HTTP | real API on Prisma persistence: signup/me work; every generation/authoring/tutor path is 404 (no route exists); no generation, trace, reasoning or provenance text in API or web responses |
| Browser | no browser-automation tool; headless Edge rendered the real web app (landing page; no generation/tutor text). No click-through flow was run - no UI was added |
| Migration / residue | none; after the suites the database held 0 `ai_generated` rows and 0 generation tables; the database and servers were removed |
| Live model | never run (no key) |

Defects found by verification and fixed: validation of a spec with a missing field threw instead of reporting (found by a unit test); a one-option multiple choice passed every existing check (now refused at generation); the read-back DNA comparison reported a false difference because Postgres `jsonb` reorders keys (found only by the real-Postgres test; now compared canonically); a deterministic id collided with an earlier rejected row (found only by the real-Postgres test; the new candidate now takes a numbered id).
