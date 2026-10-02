# 47 — Content Intelligence Pipeline (`@ipmat/content-intelligence`)

> Part of the [project memory](00_MASTER_CONTEXT.md). Source: `docs/DECISIONS.md` D-085. Built in Product Phase 6 Prompt 4.

## What it is

The path from AUTHORIZED source material to structured, traceable exam intelligence:

`authorized source -> source registration (rights gate) -> ingestion -> extraction -> normalization -> semantic chunks -> concept / relationship / question CANDIDATES (verified evidence) -> review -> knowledge graph -> retrieval representations`

**Structured intelligence is authoritative. Embeddings are retrieval aids.** Everything extracted is a candidate until a named reviewer decides it, and even an accepted candidate never edits the canonical Concept Universe or publishes a question.

## Source lifecycle and rights boundary

- A source is registered only if it passes the shared rights rule (`evaluateSourceRights`): `original` needs no external reference; anything else needs `sourceRef`; anything but `public_domain` needs `licenseRef` + a named `authority`; references naming Telegram/torrent/libgen-style channels are refused. A failing source is refused (`unauthorized_source`) and NOTHING is persisted. The same rules are DB CHECKs. free-to-access != free-to-copy.
- Source id = f(exam, key) (idempotent registration). Version id = f(source, sha256 of content): same content = same version (no work); changed content = a NEW version; versions are immutable and never overwrite validated intelligence. Raw documents are not stored (hash + chunks only).
- `real_source` vs labelled `fixture` is never ambiguous. **No real source corpus exists in the repository; every test document is a synthetic fixture.**

## Ingestion lifecycle (failure-tolerant, resumable, idempotent)

`registered -> accepted -> extracted -> normalized -> chunked -> enriched -> reviewed -> available` (+ `failed` remembering the stage). A failing stage records a stable code (never source content) and stops; `run` again resumes from that stage and converges on identical rows (deterministic ids; candidates are inserted without overwrite). `reviewed` needs every candidate decided by a person; a reviewed/available version's chunks are locked.

## Extraction and chunks

Deterministic `extractDocument` for `plain_text` and `markdown` ONLY (headings + heading path, paragraphs, pipe tables, question boundaries; locations kept; nothing dropped). PDF/OCR unsupported -> recorded `unsupported_format` failure. Chunks are structural (heading travels with its content; a question is its own chunk; sentence-boundary splitting), exactly equal to their text span, with deterministic ids. A chunk existing is not validation.

## Candidates, evidence and graph

`ConceptMentionCandidate` (exact normalized-name match to a pack concept; a non-pack concept can never be accepted), `RelationshipCandidate` (ONLY the eight established types; rationale required), `QuestionCandidate`. Every candidate carries evidence (chunk + verbatim quote + span) that is verified on creation. `proposeRelationPromotion` yields a PROPOSAL (checked against `validateExamPack`), never an edit. `buildKnowledgeGraph` derives a typed, directional graph (fixed edge kinds, no `relatedTo[]`); each edge has a `basis` (canonical / accepted_candidate / candidate); `whyRelated(A, B)` answers with structured provenance (pack provenance, or source + version + location + quote + reviewer).

## Question extraction boundary

An ACCEPTED question candidate -> `questionDraftFromCandidate` -> `ContentAuthoringService.createDraft` (a DRAFT). It must still pass every authoring gate; no solution is invented; the source's answer is a claim (a human verifies it); DNA is supplied and validated; no code path produces `published`.

## Providers, embeddings and retrieval

Provider interfaces return RAW untrusted proposals; the pipeline validates them into candidates. No vendor, no model call in this unit (a model-backed provider would use `@ipmat/ai` `generateStructured` + Zod). `RetrievalIndex` returns ranked chunk ids (filters before scoring); lexical BM25-style baseline; `VectorRetrievalIndex` behind `EmbeddingProvider` (stores vectors, never text; the hashing embedder is a deterministic stand-in, NOT semantic). `EvidenceRetriever` is the only place hits become text: it checks the principal first (content_admin / content_reviewer for that exam only; students ALWAYS denied) and re-resolves through the exam-scoped repository. Not a chat product; no tutor.

## Limits

Text formats only; heuristic question detection; deterministic providers only; in-memory retrieval index; staff principals are a domain type (no staff authentication exists); relation promotion is only a proposal; the DB cannot verify quote text. No route, UI or CMS exists.
