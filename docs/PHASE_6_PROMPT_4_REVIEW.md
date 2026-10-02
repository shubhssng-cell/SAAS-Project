# Phase 6 Prompt 4 — Content Intelligence Pipeline + Knowledge Graph (review)

Decision record: [DECISIONS.md D-085](DECISIONS.md). Pipeline reference: [project-memory/47_CONTENT_INTELLIGENCE_PIPELINE.md](project-memory/47_CONTENT_INTELLIGENCE_PIPELINE.md). Roadmap: [product-roadmap/PHASE_6_EXAM_INTELLIGENCE.md](product-roadmap/PHASE_6_EXAM_INTELLIGENCE.md). Date: 2026-10-02. Prompts 1–3 were not reopened (no regression of theirs was found). Prompt 5 NOT started.

## Real data vs fixtures — the honest status
**No real source corpus exists and none was added.** Every document the tests ingest is a synthetic text invented for the tests, registered as a labelled fixture (`dataOrigin: "fixture"`, a fixture label, source type `original`, a `fixture:` reference), created under a unique per-run key and deleted afterwards. Nothing was seeded. The pipeline is proven end to end on synthetic fixtures without pretending they are exam sources.

## What already existed (reused) and what was missing
Reused: the `Provenance`/`SourceType` vocabulary; the content-authoring rights rule (now extracted and shared as `evaluateSourceRights`) and lifecycle; the Exam Pack and the eight typed relations; the real-source/fixture distinction (Prompt 2); `normalizeConceptNameKey`; the rule that all AI calls go through `@ipmat/ai` `generateStructured`. A repository-wide search found **no** ingestion, source registry, parser, chunking, embedding, vector or retrieval code — all of that was missing.

## What was added
- `packages/domain/content-intelligence` (`@ipmat/content-intelligence`): `types`, `source`, `extract`, `chunk`, `candidates`, `providers`, `repository` (interface + in-memory), `pipeline`, `questions`, `graph`, `retrieval`.
- `evaluateSourceRights` exported from `@ipmat/content-authoring` (the provenance gate now calls it; behavior unchanged, 537 tests still pass).
- `packages/db`: migration `0015_content_intelligence` (5 enums, 5 new tables), schema, `PrismaContentIntelligenceRepository`.
- `vitest.workspace.ts` (serializes the real-database integration files — see Defects).
- Tests, and docs (D-085, this review, project-memory 47, DATABASE/ARCHITECTURE/AI_ARCHITECTURE/MASTER_PLAN/roadmap/CLAUDE.md/memory updates).

## Source model
`SourceRecord` (id = f(exam, key)) with type/ref/license/attributedTo/**authority**/data origin/fixture label; `SourceVersionRecord` (id = f(source, sha256 of content); version number; format; byte length; state; failure; attempts). Registration is idempotent; identical content is the same version; changed content is a new immutable version; raw documents are not stored (hash + chunks only).

## Ingestion lifecycle
`registered → accepted → extracted → normalized → chunked → enriched → reviewed → available`, plus `failed` (remembers the stage). Idempotent stages, deterministic ids, a stable failure code that never contains source content, resume-from-failure that converges on identical rows, rights re-checked at `accepted`, `reviewed` only when a person has decided every candidate, chunks locked once `reviewed`/`available`.

## Extraction / chunk architecture
Deterministic `extractDocument` for `plain_text` and `markdown` (headings + heading path, paragraphs, pipe tables, conservative question-boundary detection, locations on every block; nothing dropped — property-tested). PDF/OCR unsupported (recorded as an `unsupported_format` failure). Chunks are structural: heading travels with its content, a question is its own chunk, sentence-boundary splitting, exactly equal to their span, deterministic ids; existence ≠ validation.

## Knowledge graph, relationships and provenance
Derived (never stored) typed graph: `has_section`, `has_chapter`, `located_in`, `concept_relation` (one of the EIGHT relation types), `has_pattern`, `instance_of`, `about`, `version_of`, `derived_from`, `mentions`; fixed endpoint rules enforced by `validateGraph`; **no `relatedTo`**. Every edge has a `basis` (canonical / accepted_candidate / candidate-on-request); rejected candidates and non-pack concepts never appear. `whyRelated(A, B)` answers with structured provenance — the pack's own provenance, or source + version + location + verbatim quote + proposer + reviewer. Candidate relationships may use only the eight established types (`example-of`, `tested-by`, `appears-in`, `related-to`, `depends-on`… are rejected); relation promotion is only a proposal checked against `validateExamPack` (a prerequisite cycle is caught) and is never applied.

## Question-extraction boundary
Accepted question candidate → `questionDraftFromCandidate` → `ContentAuthoringService.createDraft` (a draft). The source's answer is only a claim (a human must verify), no solution is invented, DNA is supplied and goes through the DNA gates, an AI classification gets the AI caution, and no code in the package can produce `published` (tested).

## Retrieval / embedding abstraction and provider abstraction
`RetrievalIndex` returns ranked chunk ids only (metadata filters before scoring); lexical BM25-style baseline; `VectorRetrievalIndex` behind an `EmbeddingProvider` interface (vectors + metadata only, never text; the hashing embedder is a deterministic stand-in, not semantic). `EvidenceRetriever` is the only place hits become text: principal checked first (students always denied), every hit re-resolved through the exam-scoped repository, so a poisoned index, a cross-exam id or a rejected chunk cannot widen access. Extraction providers are interfaces returning raw untrusted proposals; the default is deterministic; no vendor is named and no model is called anywhere in the package (tested). **Structured intelligence is authoritative; embeddings are retrieval aids.**

## Migration 0015
Additive: five new tables, no existing table altered. CHECKs enforce the rights boundary at the database (third-party material needs reference + license + authority; unauthorized-channel markers refused), fixture-vs-real-source, key/hash/failure/chunk/evidence shapes and "a candidate is decided iff it has a reviewer". Verified on real Postgres: applies from an empty database; applies over a database already holding data (3 published questions, relations, a student unchanged); `prisma migrate diff` against a shadow database: **No difference detected**. Reversal is manual and controlled (header of the migration).

## Verification (exact)
| Check | Result |
|---|---|
| Focused `@ipmat/content-intelligence` | 10 files, **465 tests** (source 29, extract 84 incl. a 60-seed property, chunk 72 incl. property, candidates 38, pipeline 22, questions 8, graph 19, retrieval 26, properties 160 (40 seeds × 4), boundary 7) |
| `@ipmat/db` new | fake-client **4** + real-Postgres integration **25** |
| API leakage (real HTTP + real Postgres) | **6** tests |
| Real Postgres 16 (disposable, `127.0.0.1:55432`, `ipmat_test`; 5432 untouched) | rebuilt from empty twice; migrations 0001–0015 apply; seed run; no drift |
| Full suite WITH Postgres | **271 files, 4501 tests, all pass** |
| Full suite WITHOUT Postgres | 257 files pass, 14 skipped; **4300 pass, 201 skipped** (DB-gated), 0 fail |
| typecheck / build / `git diff --check` | clean. Lint first flagged literal BOM/NBSP characters and a needless escape in `extract.ts`; fixed with escapes, re-linted clean, 465 tests re-run |
| Architecture boundary | `domainBoundary.test.ts` covers the new package; its own boundary test pins imports to the existing domain packages + `node:crypto`, forbids any vendor name, network call, `published` state, publication function, new relation type, clock read, student-state or prediction vocabulary, and checks retrieval authorizes before searching |
| Security / leakage | raw HTTP on real Postgres with sentinel-bearing source text, chunks, candidates, an extracted unpublished question, hashes, proposer/reviewer ids: none appears in start/refusal, recommendation, practice start/submit/result or the training hub; no student route reaches sources/ingestion/chunks/candidates/graph/retrieval. **Rendered HTML:** headless Edge walked the real student flow (practice ×8, results, training hub, dashboard — up to 26 pages per run, three runs) with the pipeline sentinels present and a positive control that practice content was served: zero pipeline strings in any page's HTML and no console errors. (A first, over-broad audit regex matched the existing CSS class `.evidence-list` of the Phase 4 autopsy UI; that was a false positive of the audit pattern, not a leak, and the pattern was narrowed.) |
| Browser QA | signup → onboarding → enroll → dashboard → practice-next → question → select → submit ("Correct.") → training hub; no console errors. Two runs hit a cold-start race before the servers were ready; reruns passed. No UI was added or needed (no admin route exists, so there is no authorization/ingestion/review state to test in a browser; those are covered at HTTP level and domain/DB level) |
| Phase 1–5 regression | the whole prior suite incl. real-Postgres practice/training integration passes unchanged |
| Prompt 1 / 2 / 3 regression | exam-pack, examiner-intelligence and content-authoring suites plus their Postgres integration and leakage tests pass (the shared rights rule was refactored out of the Prompt 3 gate with its 537 tests unchanged) |
| Cleanup | container removed, no process left on 55432/4001/5184, temp password and the temporary seeding script deleted |

## Defects found and fixed (classified)
- **Test infrastructure / pre-existing latent hazard (found by the full Postgres run):** two Phase 4 integration tests that assert the exact published set failed because the Prompt 3 integration tests (which publish questions in the shared DB) overlapped them in a parallel run. Not a product defect and not a Prompt 4 defect. Fixed by `vitest.workspace.ts`, which runs the real-database integration files serially; no assertion changed, the 271-file full suite then passed.
- **Schema defect:** my first draft of the version-shape CHECK restricted `format` to supported values, which made an unsupported-format failure unrepresentable (the pipeline crashed instead of recording it). Found by the real-Postgres test; the CHECK now requires only a declared non-blank format; the database was rebuilt from empty.
- **Test defects:** a wrong expectation about a heading block's own path; a chunk-coverage property that wrongly required a split block to fit inside one chunk (the real invariant — no character lost — is now what is tested); a hash-collision assumption in the vector contract test; a self-contradicting graph assertion.
- **Lint:** literal BOM/NBSP characters and a useless escape in `extract.ts`.
- `migrate dev` rewrote a comment in `migration_lock.toml` (reverted).

## Known limitations
Text formats only (no PDF/OCR); question detection is a conservative heuristic; the only enrichment providers are deterministic (name matching, question boundaries) — there is no model-backed provider, so relationship extraction exists as an interface and a scripted test double only; the hashing embedder is a stand-in and the retrieval index is in-memory and rebuilt per exam (no vector store); content-staff principals are a domain type with no authentication yet, so any future route must derive the principal from real auth; relation promotion is only a proposal (nothing writes it into the canonical Concept Universe); the database cannot verify that evidence quotes match chunk text (the domain does at creation); the unauthorized-source guard is a narrow marker check, not a rights determination; no route, UI, CMS or tutor exists; a real corpus remains to be sourced and authorized.
