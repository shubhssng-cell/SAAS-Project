# Phase 6 Prompt 3 — Question Universe + Content Authoring + Validation (review)

Decision record: [DECISIONS.md D-084](DECISIONS.md). Roadmap: [product-roadmap/PHASE_6_EXAM_INTELLIGENCE.md](product-roadmap/PHASE_6_EXAM_INTELLIGENCE.md). Date: 2026-10-02. Prompts 1 and 2 were not reopened (no regression found). Prompts 4–5 NOT started.

## Real data vs fixtures — the honest status
**No real authored question corpus, no historical data and nothing seeded was added.** Every question written by a test is a labelled fixture (`original` source, a `fixture:` source reference, a unique per-run id prefix) and is deleted afterwards. The three pre-existing seeded published questions are untouched. A new authored question is not historical and a historical record is not publishable content; the two layers stay separate.

## Existing structures reused (nothing duplicated)
`ValidationState` (the whole lifecycle — no state added), `decidePublication` and `requiresHumanReview` (publication rule), `QuestionDnaData` and Prompt 2's `validateDnaClassification` (DNA/concept/pattern/difficulty/time gates), `verifyComputation` / `compareReverification` / `validateSingleCorrectAnswer` / `validateNoAnswerLeakageInStem` / `validateNoCompletenessClaims` / `checkDuplicateRisk`, the `Provenance` source vocabulary, the six difficulty dimensions, four novelty levels, `TestingMode`, `ErrorTaxonomy`, the Exam Pack graph, the importer's natural-key resolution, the existing student readers, the `IPMAT_TEST_DATABASE_URL` convention.

## What was missing
A path for human-authored questions; any code that sets `human_reviewed` or records a reviewer; a layered, machine-readable "why not publishable" report; an answer-trust rule for AI content; stable identity beyond "same cell + exact stem"; a universe that separates pattern coverage from question count.

## What was added
- `packages/domain/content-authoring` (`@ipmat/content-authoring`): `types`, `fingerprint`, `gates` (11 gates), `lifecycle`, `universe`, `repository` (interface + in-memory), `service`.
- `packages/db`: migration `0014_question_authoring`, schema columns/enum, `PrismaQuestionAuthoringRepository`.
- Tests: 7 domain test files; db fake-client + real-Postgres tests; a real-HTTP leakage test in `apps/api`.
- Docs: D-084, this review, roadmap, MASTER_PLAN, DATABASE, ARCHITECTURE, CLAUDE.md rule, project-memory (11, 42, 46, 90, 92, 99).

## Question Universe model
Five things stay apart: concept / pattern family / question DNA / question instance / question content. `buildConceptUniverse` (pure, derived on every call) reports, per concept: mapped pattern families (zero rows kept), combinations (pack graph + observed), the whole `TestingMode` vocabulary, all four novelty levels, all five tiers, traps, provisional expected-time bands, and per-dimension low/mid/high counts of the six difficulty dimensions (no composite score). Every region has `total` (non-rejected) and `published` and is `empty | underrepresented | represented`. **Pattern coverage != question count:** patterns also report `distinctSignatures`, `topSignatureShare`, `concentrated` — 100 published questions of one structure show one signature and are flagged. Only the pack's own exam is counted. No completeness field exists. Thresholds are PROVISIONAL (`UNIVERSE_THRESHOLDS`, `TIME_DEMAND_BANDS`).

## Authoring lifecycle
Existing `ValidationState`: `draft` → (no failed gate) `ai_validated` → (named reviewer) `human_reviewed` | `rejected` → (`publishQuestion`, the only path) `published`. An AI proposal is a draft with `origin: "ai_generated"`. Editing returns to `draft`, drops the review, keeps the id; published/rejected are terminal. "Structured" is derived (the structure/metadata/dna gates), never stored.

## Validation lifecycle / gates
`structure`, `metadata`, `dna`, `concept`, `pattern`, `difficulty_novelty`, `expected_time`, `answer`, `identity`, `provenance`, `review` — each `passed | failed | requires_human | not_applicable` with stable reason codes. Answer: deterministic recomputation; a failed recomputation is final (no reviewer override); no derivation → `requires_human`; `ai_generated`/`unknown` origin also needs an independent re-derivation or a reviewer's verification. Identity: exact duplicate fails; near-duplicate (token overlap, D-019) needs a human and is never merged. Schema-valid ≠ exam-valid ≠ pedagogically good: `publishable` only means no known gate blocks publication.

## Publication gates
`publishQuestion` re-evaluates all 11 gates at publication time, requires `publishable`, then applies the existing `decidePublication` (Hard/Extreme/Novel need human review; provenance required). Verified by tests, including a 60-seed random-walk property (published ⇒ no failed/open gate; AI ⇒ independent check or verified answer; Hard/Extreme/Novel ⇒ a review record; terminal states final; id never changes).

## Provenance / rights
Reuses the source vocabulary. `original` needs no external reference; anything else needs `sourceRef`; anything but `public_domain` also needs `licenseRef`; AI content must reference its generation record; a narrow guard refuses references naming known unauthorized-distribution channels (a refusal to ingest the obvious, not a rights determination).

## Database / migration 0014
Additive and data-preserving: enum `QuestionAuthoringOrigin`; eight NULLABLE columns on `questions` (origin, content fingerprint, internal review record, independent re-verification); partial unique index `questions_exam_content_fingerprint_unique` (one logical question per exam, excluding rejected); CHECKs `questions_review_pair`, `questions_fingerprint_needs_origin`. Legacy rows keep NULL and read as origin `unknown` (never guessed human). Verified on real Postgres: migrations 0001–0014 apply from empty; applying 0014 over a database already holding the seed leaves the 3 published questions unchanged; `prisma migrate diff` against a shadow database: **No difference detected**. Reversal is manual and controlled (documented in the migration header).

## Verification (exact)
| Check | Result |
|---|---|
| Focused `@ipmat/content-authoring` | 7 files, **537 tests** pass (gates 44, lifecycle, universe 21, identity, service, 60-seed properties, boundary 6) |
| `@ipmat/db` new | fake-client **4** + real-Postgres integration **24** |
| API leakage (real HTTP + real Postgres) | **8** tests |
| Real Postgres 16 (disposable, `127.0.0.1:55432`, `ipmat_test`; 5432 untouched) | rebuilt from empty after the defect below; migrations 0001–0014 deploy; seed run; no drift |
| Full suite WITH Postgres | **258 files, 3999 tests, all pass** |
| Full suite WITHOUT Postgres | 246 files pass, 12 skipped; **3829 pass, 170 skipped**, 0 fail |
| Final targeted re-run after the last test-only fix | 27 files, 1434 tests pass (content-authoring, examiner-intelligence, exam-pack, db pack/historical/authoring, API leakage, architecture) |
| typecheck / lint / build / `git diff --check` | clean (typecheck and lint initially flagged my own test helpers — fixed; build re-run clean) |
| Architecture boundary | `domainBoundary.test.ts` covers the new package; its own boundary test pins imports to the existing domain packages + `node:crypto`, forbids any model call/vendor name, new difficulty score, prediction field, student state and clock reads |
| Security / leakage | raw HTTP: draft / ai_validated / human_reviewed questions cannot be started, recommended or listed and refusals leak nothing; a published question leaks no answer key before submission and no reviewer/source/provenance/fingerprint/origin/internal id ever; no student route reads authoring data. **Rendered HTML:** headless Edge walked the real student flow across **26 pages** (practice ×8, results, training hub, dashboard) with sentinel-bearing questions in every state, including a positive control where the published sentinel question WAS served — zero sentinel/reviewer/source/internal strings in any page's HTML |
| Browser QA | signup → onboarding → enroll → dashboard → practice-next → question → select → submit ("Correct.") → training hub, no console errors; no student-visible feature was added and no CMS was built. (An earlier attempt hit a cold-start race before the servers were ready; the rerun passed.) |
| Phase 1–5 regression | the whole prior suite incl. real-Postgres practice/training integration passes unchanged |
| Prompt 1 / Prompt 2 regression | exam-pack and examiner-intelligence suites plus their Postgres integration tests pass |
| Cleanup | container removed, no process left on 55432/4001/5184, temp password and the temporary seeding script deleted |

## Defects found and fixed
- **Real regression caught by the existing Phase 5 integration suite (13 failures):** my CHECK `questions_human_reviewed_has_review` rejected `human_reviewed` rows that existing tests/flows create without a review record. Removed from the migration (rule kept in the authoring `review` gate); the disposable database was rebuilt from empty and the full suite re-run clean. My own constraint test was rewritten to assert the rule is a gate, not a DB rule. (An earlier claim that "no code sets human_reviewed" had overlooked test data.)
- A vacuous test assertion (`r.id` on a record that has no `id`) found by typecheck; corrected to `r.question.questionId` and given a positive control.
- Test-fixture bodies sharing vocabulary tripped the (working) near-duplicate gate; fixtures now use disjoint vocabulary.
- Lint/typecheck on my own test helpers; a message string containing "prediction" tripped my own boundary scan (reworded).
- `prisma format` realigned `schema.prisma` and `migrate dev` rewrote a comment in `migration_lock.toml` (reverted).

## Known limitations
The persisted name for "automated gates passed" stays `ai_validated`, even for human-authored content. Near-duplicate detection is token overlap (not semantic) and will flag unrelated, similarly worded questions for a human. Only Percentages pattern families/taxonomy cells exist; authoring requires an existing cell. The importer (D-050) does not yet write fingerprints (pipeline imports are protected by the gate, not the index). `human_reviewed` without a review record is not a database rule. The unauthorized-source guard is a narrow marker check. Universe thresholds are provisional. No authoring route, review UI or CMS; no real authored corpus; no generation engine; no live-AI involvement.
