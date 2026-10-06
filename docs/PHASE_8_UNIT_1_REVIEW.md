# Phase 8 Unit 1 — AI Tutor Foundation

Decision record: [DECISIONS.md D-092](DECISIONS.md). Code: `packages/domain/tutor` (`@ipmat/tutor`, pure) and the `tutor-response` task/schema in `packages/ai`.

> **Superseded in part by Unit 2 (D-093):** the key is now disclosed only for a SUBMITTED attempt (not any finalized one), the missing-attempt code is `submitted_attempt`, and the prompt version is `tutor-response-v2`. See [PHASE_8_UNIT_2_REVIEW.md](PHASE_8_UNIT_2_REVIEW.md).

## 1. Specification audit

**A. Explicitly specified about tutoring:** almost nothing. `product-roadmap/PHASE_0_PRODUCT_DEFINITION.md` §8 lists a "general-purpose AI chatbot" and a "voice tutor" as OUT of scope for the initial product. PRODUCT_SPEC / D-005 / D-006 fix the hard rules (no confidence or psychological inference, a diagnosis is a hypothesis until confirmed, no fake AI). `hint_opened` and `solution_opened` exist only as attempt events. Phase 6 Prompt 4 and D-085 record "no tutor" as not built. No document defines hint levels, when an answer may be revealed, a tutoring tone, or conversation memory.

**B. Safe to build now:** provider-isolated model calls (the existing `@ipmat/ai` abstraction already supports timeouts, retries, malformed-output handling and test doubles), a deterministic context contract with ownership checks, a deterministic grounding validator, a response contract, and explicit conservative per-intent policy objects.

**C. Not specified (listed in `UNRESOLVED_TUTOR_POLICIES`, not invented):** hint levels and what each may reveal; whether the key may be shown before an attempt, or after a skip/abandon; which student evidence (revision, curriculum, simulation, confirmed autopsy) each intent may use — **none do in Unit 1**; whether authorized source text may be quoted to a student; conversation memory and multi-turn behaviour (none built; every request is independent); rate limits, quotas, budgets; tone, language, reading level; how an answer is shown/flagged/reported; whether refused requests need an audit entry.

## 2. Architecture

```
TutorRequest(intent, studentId, enrollmentId, questionId|conceptName, focus?)
  -> buildTutorContext        (context firewall; ports re-verified)         context.ts
  -> pre-check                (insufficient_context BEFORE any model call)
  -> prompt construction      (field-by-field, no spread)                   prompts.ts
  -> generateStructured       (@ipmat/ai provider; task "tutor-response")   service.ts
  -> validateTutorGrounding   (deterministic; regenerate <=2 then reject)   grounding.ts
  -> TutorResponse + metadata-only audit
  -> toStudentTutorView       (the only shape a route may expose)           view.ts
```

Domain imports only `@ipmat/ai`, `@ipmat/concept-graph`, `@ipmat/content-intelligence` and `node:crypto` (boundary test). No vendor SDK, no Prisma, no network, no environment access, no key in source.

## 3. Intents (provisional contracts, `policy.ts`)

`explain_question`, `explain_concept`, `give_hint`, `explain_mistake`, `clarify_solution`. Each policy fixes: what it needs (question/concept/finalized attempt/authored solution), key disclosure (`never` | `after_finalized_attempt`), whether attempt facts and approach-revealing DNA are included, whether the graph and optional source retrieval are used, whether hypotheses are allowed (only `explain_mistake`), allowed response types. A hint and a concept explanation never receive the key; the other three receive it only once THIS student has a finalized attempt on THIS question.

## 4. Context contract and firewall

Exam comes from the verified enrollment. Re-verified on every call: enrollment belongs to the student (one error for "missing" and "someone else's"); question is published and in that exam; attempt belongs to the student and the question; evidence and source items of another student/exam are dropped. Included only as the intent needs: question (stem/options), concept + 1-hop non-speculative graph edges (each with rationale and certainty), student-safe DNA subset (testing modes and trap label only after a finalized attempt), the student's own recorded attempt, optional source chunks with provenance. Never serialized into a prompt: student/enrollment/attempt/question ids, taxonomy-cell id, trap code, internal tokens. References are opaque (`question`, `attempt`, `answer_key`, `source:<n>`, `concept:<name>`, `edge:...`, `dna`). The withheld key lives only in a `ProtectedKey` consumed by the validator.

## 5. Provider abstraction

The existing `AiProvider` + `generateStructured` (Anthropic and Fixture providers exist; a future OpenAI/Google adapter implements the same interface). `createTutorService` takes the provider by injection; there is no factory that reads a key. Timeout, provider error and malformed output are classified (`timeout | provider_error | malformed_output`) into a `provider_failure` outcome with fixed text; provider messages never reach the response.

## 6. Retrieval and grounding

Retrieval reuses Phase 6 `EvidenceRetriever` via `createEvidenceRetrieverSourcePort(retriever, principal)`. The caller supplies the principal; the retriever's rule that students are ALWAYS denied is untouched, so a student request records `sourceAccess: "denied"` and the tutor proceeds on structured context only. Provenance (title, location, version) is carried; chunk ids and source keys stay internal.

Grounding checks (all deterministic): allowed response type; every citation exists in the supplied context; an answered response cites something; hypotheses are hedged, only for permitted intents, tied to the attempt; claimed concept relations exist in the supplied graph (direction included); quotes are verbatim; withheld key/solution not asserted; no UUID/own id/internal token; no other-exam name (when the other exams' names are supplied); psychological claims; mastery/readiness/strength/weakness/outcome claims; exam rules only when retrieved source text states them; misreported attempt facts. Failure → bounded regeneration (violation codes only fed back) → `rejected_ungrounded`, no model text returned.

## 7. Response contract

`TutorResponse`: outcome (`answered | insufficient_context | rejected_ungrounded | provider_failure`), response type, explanation text (AI_EXPLANATION), fixed fallback message, source references (SOURCE_CONTENT, with provenance), evidence references with epistemic class, hypotheses (AI_HYPOTHESIS, separate), uncertainty/missing, grounding report, audit. No reasoning field exists; the schema strips unknown keys, so a model's `reasoning`/`chainOfThought` can never be stored or shown.

## 8. Security and privacy

Student, enrollment, exam, question and source-rights isolation are tested (including hostile ports that return another student's attempt/enrollment or another exam's question/source). Audit entries carry ids, intent, outcome, a context digest, section names, violation codes and model metadata — never a prompt, response, question text or student free text. A throwing audit sink cannot change a student's result. `focus` is length-capped, control-stripped, delimited as data, and cannot close its own delimiter. No route or UI exists, so there is no HTTP/HTML surface; `toStudentTutorView` is tested to carry no ids, digests, model metadata, chunk ids, violation codes or grounding internals.

## 9. Not built / limitations

- No route, UI, persistence, conversation memory, migration, rate limit or Prisma-backed ports; nothing calls the tutor yet.
- The validator is non-semantic: paraphrased key leakage, subtle factual errors, or invented question facts outside the checked patterns can pass — hence the key is withheld from the prompt first. Lexicons over-reject by design.
- No live model has ever been run (no API key in this environment): the tutor has only run against deterministic test doubles.
- Refused requests (`TutorError`) are not audited. Evidence kinds (revision, curriculum, simulation, confirmed autopsy) exist in the vocabulary but no intent may carry them.

## 10. Future extension points

Prisma-backed ports (ownership, question, attempt) behind a route that exposes only `StudentTutorView`; per-intent evidence allow-lists once the product decides them; hint levels; a source-quoting policy; conversation memory (requires a recorded decision first); additional providers behind `AiProvider`.

## 11. Verification

| Check | Result |
|---|---|
| Focused tutor + `@ipmat/ai` tests | 7 files, 143 tests passed (tutor: context 30, grounding 49, service 33, boundary 11, properties 7) |
| Full suite, real Postgres 16 (disposable, `127.0.0.1:55432`, 5432 untouched, migrations 0001-0016 + seed) | 308 files, 7114 tests passed |
| Full suite, no Postgres | 287 files passed, 21 skipped (DB-only); 6851 tests passed, 263 skipped |
| Typecheck / lint / build | all clean |
| `git diff --check` | clean (one trailing blank line in DECISIONS.md found and fixed) |
| HTTP | real API on Prisma persistence: signup/me work; every `/v1/tutor*` path is 404 (no route exists); no tutor/chain-of-thought/key text in training responses |
| Browser | no browser-automation tool was available; headless Edge rendered the real web app (landing page, no error/tutor text). No click-through flow was run - no UI was added |
| Migration | none (no persistence); database was disposable and removed |
| Live model | never run (no key) |

