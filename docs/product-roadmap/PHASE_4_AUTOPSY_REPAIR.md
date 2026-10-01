# Product Phase 4 — Question Autopsy → Confirmation → Repair → Targeted Practice

## Phase objective

From the master roadmap: *the confirm/correct UI ships; a wrong answer can lead to a confirmed diagnosis and a repair question, in-product.* The engineering foundations already exist as domain code (`@ipmat/autopsy`, `@ipmat/repair-selection`, the attempt lifecycle, mastery, adaptive selection, orchestration). Phase 4 integrates them into the real student flow, one small unit at a time, keeping the project's rule that **observation ≠ evidence ≠ hypothesis ≠ diagnosis** (docs/DECISIONS.md D-005, D-006).

Numbering is **Phase-4-relative** (Unit 1 … Unit 5); there is no relation to the old global unit counts.

## Unit status

| Unit | Scope | Status |
|---|---|---|
| Unit 1 | Autopsy **evidence** (observation only) surfaced in the real student flow | **COMPLETE** (below) |
| Unit 2 | Hypothesis generation + student confirmation / correction | **COMPLETE** (below) |
| Unit 3 | Persist confirmed diagnosis + RepairPlan | **COMPLETE** (below) |
| Unit 4 | Targeted repair-question selection + adaptive integration | NOT STARTED (not begun) |
| Unit 5 | Full end-to-end Autopsy → Repair → improved-practice hardening | NOT STARTED |

*(This is a working plan; later units may be adjusted when they start.)*

## Unit 1 — Autopsy evidence surfaced in the real student flow

> **Unit 1 answers "what happened?" — never "why did it happen?".** It reports recorded and derived facts about one finalized attempt. It does not diagnose, hypothesize, label, or repair, and it makes no claim about the student.

### Boundary

```
Attempt  ─►  Observable Evidence   ◄── Unit 1 implements exactly this
                 │
                 ▼  (later units, none built here)
            Hypothesis  ─►  Confirmation  ─►  Diagnosis  ─►  RepairPlan
```

Not built, deliberately: LLM hypothesis generation, any confidence/psychology, student confirmation UI, persisted diagnosis, RepairPlan creation, targeted repair selection, new adaptive scoring, ML, embeddings, RAG, a vector store. No database table, schema or migration was added.

### What already existed (inspected)

- `@ipmat/attempt`: `toAutopsyEvidence()` / `AttemptAutopsyEvidence` (the finalized-attempt contract, a structurally psychology-free type), `deriveAnswerChangeHistory()`.
- `@ipmat/autopsy`: `buildAutopsyOutput()` (deterministic signals **plus** a candidate error category from the error taxonomy — diagnosis-adjacent, therefore **not used** by Unit 1), `deriveBehaviorSignals()` (used for the time ratio), `HistoricalAttemptRecord`.
- `@ipmat/training-recommendation`: the persisted-state composition (finalized history, the published DNA pool, canonical questions, concept links) — reused.
- `@ipmat/practice-api` / `@ipmat/api` / `apps/web`: result endpoint and result screen — extended.

### Evidence model (`ObservationEvidence`, `@ipmat/autopsy/src/observationEvidence.ts`)

A pure, deterministic builder over the existing contracts. It adds no metadata that was not already recorded, and it carries **no answer key** (`correctAnswer` is not a field; the graded verdict is the only answer-related fact).

| Group | Fields | Source |
|---|---|---|
| identity | `studentId`, `attemptId`, `questionId` | observed |
| outcome | `status` (`submitted`/`skipped`/`abandoned`), `verdict` (`correct`/`incorrect`/`not_graded`), `selectedAnswer` | observed |
| timing | `elapsedSeconds` (finalizedAt − startedAt, recorded by the lifecycle), `expectedSeconds` (question metadata) | observed |
| | `timeRatio` (= elapsed ÷ expected, only when both are valid) | **derived** |
| interaction | `recordedSelectionCount`, `hintEventsRecorded`, `solutionOpenedRecorded` | observed (counts/flags of *recorded* events) |
| | `answerChangeCount`, `answerChanged` | **derived**, and **unknown (`null`) unless ≥ 2 selections were recorded** |
| eventSequence | the recorded events, in order (type + timestamp only) | observed |
| questionContext | chapter, concept, pattern family, taxonomy cell, difficulty tier, novelty level, testing modes, combining concepts | observed (question metadata); `null` = unknown |
| history | counts of prior outcomes on the same concept / pattern family / taxonomy cell / question, prior-attempt total, the last ≤ 5 outcomes on the concept | **derived**; `null` = no earlier attempts, or unknown |
| fieldSources | field path → `observed` \| `derived` (a constant table, `OBSERVATION_FIELD_SOURCES`) | — |
| unknown | paths that are unknown for this attempt, plus `never_collected.{reasoning, working_steps, confidence, intent}` | — |

**Observed vs derived vs unknown.** *Observed* = a fact the system recorded. *Derived* = a deterministic calculation from observed facts (time ratio, change count, history counts). *Unknown* = not available: the value is `null` and its path appears in `unknown`; it is **never guessed, defaulted or zero-filled**. `confidence` and `intent` are explicitly *never collected* and have no field.

**An honesty point discovered while inspecting.** The real student flow records exactly **one** `answer_selected` event, at submission, and no `question_opened`, `answer_changed`, `hint_opened` or `solution_opened` events (the UI has no hints and does not send selection changes). One recorded selection is consistent with "never changed" *and* with "changed but not recorded", so the change count is **unknown**, not 0 — the student sees "Changes to your answer before submitting are not recorded in this practice flow." rather than a false "you did not change your answer". Hint/solution fields are named as counts of *recorded* events for the same reason. (Recording selection changes in the UI is a possible later addition; Unit 1 does not add it.)

### Integration point in the student flow

```
Start Practice → question → answer → Submit → finalized attempt → result screen
                                                                     │
                     GET /v1/attempts/:id/evidence  ◄────────────────┘  (after the result is showing)
```

- `TrainingRecommendationService.getAttemptObservationEvidence()` (`@ipmat/training-recommendation`) verifies enrollment ownership, loads the student's finalized attempts (total order: finalization time, then id), the published DNA pool, the canonical question and the concept link, and calls `buildObservationEvidence()`. Prior attempts whose question is outside the published DNA pool, whose canonical question cannot be loaded, or whose concept link does not resolve are **excluded** from history (the same rule mastery uses), never given invented context.
- `PracticeApiService.getAttemptEvidence()` (`@ipmat/practice-api`) verifies the attempt belongs to the requesting student, **refuses an attempt that is still `in_progress` (409)** so nothing can be read before submission, and maps the evidence to a student-safe `AttemptEvidenceView` (`observations`, `facts`, `context`, `history`, `notRecorded`). It is the only place evidence becomes sentences.
- `apps/api`: `GET /v1/attempts/:attemptId/evidence` (auth required; 401/403/404/409 as for the result endpoint).
- `apps/web`: `adapter.getAttemptEvidence()` and a "What was recorded" card on the result screen (graded and skipped). It is **supplementary**: it loads after the result is on screen, and a failure or empty evidence simply shows nothing — the result and Continue are never blocked.

### Student-facing copy (fixed templates; observation only)

"Your selected answer was B." · "Your answer was correct/incorrect." · "You skipped this question." · "You took 86 seconds." · "The expected time was 60 seconds." · "That is about 1.4 times the expected time." · "You changed your answer once before submitting." (only when ≥ 2 selections were recorded) · "You opened 2 hints." / "You opened the solution during this attempt." (only when recorded) · "This question was in Percentages, pattern "Reverse Percentage", at the standard level." · "Before this attempt you had 3 earlier attempts on Percentages: 1 correct, 2 incorrect."

Every sentence restates a number; none gives a cause, a label, or a judgment beyond the graded verdict (tests assert an exact template allow-list and ban causal/psychological words).

### Privacy / safety boundary

- **No answer leakage.** Nothing exists before submission (server refuses; the page shows no evidence card; the question page has no key). After submission the view carries the student's *own* selected answer and the verdict; it has no answer-key or solution field (the existing result endpoint already shows those after submission, unchanged).
- **No psychological inference.** There is no field for confidence, motivation, intelligence, ability, emotion, personality or intent (D-005/D-006); `never_collected.*` states their absence.
- **No diagnosis.** No candidate error category, taxonomy lookup, hypothesis, or repair exists in the evidence object or the view (tests assert this structurally and by scan). `AutopsyOutput`'s `candidateErrorEvidence` is deliberately not exposed.
- **Read-only.** Asking for evidence writes nothing (verified on real Postgres: no `autopsies`, `repair_plans` or `mastery_states` row is created by it).

### Persistence and reproducibility

Nothing is stored. The evidence is rebuilt on every request from the persisted attempt, its events and the persisted question metadata, and it depends only on the attempt and the attempts finalized **before** it — so later practice never changes what an older result says, and a fresh API process or a second instance returns the identical object (verified on real Postgres and in the browser, including across a hard API restart).

### Tests

- `packages/domain/autopsy/test/observationEvidence.test.ts` (**18**): correct / incorrect / skipped / abandoned; timing and the derived ratio (and every way it becomes unknown); answer-change unknown-vs-derived (1 vs ≥ 2 recorded selections); recorded hint/solution; deterministic event ordering; unresolved question context; no-history `null`; multi-prior history at concept / family / cell / question level; the attempt never counts itself; order-independence of supplied priors; the recent-outcomes window; every emitted field has a declared source; `never_collected` always listed; purity and determinism; no diagnosis / answer-key / psychological field.
- `packages/practice-api/test/attemptEvidence.test.ts` (**11**): through the real attempt lifecycle and in-memory repositories — exact sentences for incorrect / correct / skipped; history counts and an earlier result unchanged by later attempts; a new service over the same state returns the identical view; missing metadata is unknown, not guessed; read-only; refused before submission; other student / other enrollment / unknown attempt; no answer key, diagnosis or psychological wording; a template allow-list for every sentence.
- `apps/api/test/devContent.test.ts` (+3): the real HTTP path on the in-memory server: 409 before submission, evidence after; a skip; 401/403/404; history and reproducibility.
- `apps/web`: adapter (+2: mapping, malformed/refused) and the result screen (+4: the card, omission when absent, wording, supplementary wiring).
- `apps/api/test/prismaPersistence.integration.test.ts` (**real Postgres**, +4, opt-in): evidence from the persisted attempt and identical on a restarted and a second instance; 409 / 403 / skip / 404; history from persisted rows and unaffected by later practice; no autopsy / repair-plan / mastery row is created.

### Validation

Default suite (no database): full repository **2012 passed + 50 skipped** across 193 files (was 1974 + 46); the 50 skipped are the opt-in real-database suite, run separately on real Postgres: **50/50 passed** (was 46). New tests: autopsy +18, practice-api +11, api HTTP +3, web +6, real-Postgres +4. Typecheck (all workspaces), build, lint and `git diff --check` clean. Existing tests needed no assertion changes.

**Real PostgreSQL** (the same disposable-container procedure as earlier units: `postgres:16-alpine` on `127.0.0.1:55432`, random throwaway password never written to the repo, database `ipmat_test`; the unrelated Postgres on 5432 was not touched), through the real HTTP server on the real Prisma repositories: submit → persisted finalized attempt → evidence whose answer, verdict and elapsed seconds equal the persisted row → the identical object from a **restarted** instance and a **second** instance; 409 before submission, 403 for another student, 404 for an unknown attempt, a skip reported as a skip; history counts equal the persisted earlier attempts and an earlier attempt's evidence is unchanged by later practice; no `autopsies`, `repair_plans` or `mastery_states` row is created by submitting or by reading evidence (and `/autopsy` still reports nothing pending).

**Browser verification** (raw CDP / headless Edge; real `apps/web` + real `apps/api` in Prisma mode + the disposable Postgres; no fixture adapter): **18/18 checks.** Login → dashboard → Start Practice → question → answer → Submit → result:
1. **Incorrect answer with two earlier attempts:** before submission the page shows no evidence, no answer key and no solution, and the real API refuses evidence for the open attempt (409, asked from the browser with its session). After submitting, the "What was recorded" card appears on the result screen only; the selected answer and verdict equal the persisted attempt, the elapsed seconds equal the persisted `time_spent_seconds`, expected time and ratio are stated as numbers, the history sentence equals the persisted earlier outcomes, unrecorded answer changes are stated as not recorded, and there is no diagnostic/psychological wording or `undefined`/`null`. A hard page refresh shows identical evidence; after the API process was **killed and restarted** the same evidence is reconstructed from Postgres; **Continue** still reaches the next recommendation.
2. **Correct answer:** the recorded verdict and the student's own answer only; no history sentence for a first attempt.
3. **Skipped:** "You skipped this question." with no selected answer or grade; Continue available.

### Limitations

- **Answer changes, hints and solution opening are effectively unobserved in the current student flow** (one recorded selection; no hint UI; the solution is shown only after submission). The evidence says so instead of filling the gap. Capturing selection-change events in the UI would be a separate, deliberate addition.
- Elapsed time is `finalizedAt − startedAt` as recorded, so it includes time on the page before the first interaction; a very short attempt can read "0 seconds" and "about 0.0 times the expected time" — accurate, if unglamorous.
- History is computed over all of a student's earlier finalized attempts (an unbounded V1 policy shared with mastery); a question outside the published DNA pool is excluded from history.
- Only `Percentages` content exists, so concept/family/cell history is shallow in practice; this unit proves the path, not its usefulness on a real bank.
- The evidence is not shown on the separate "what the system noticed" (autopsy) screen, which is unchanged and still has no hypothesis source.
- Real-database and browser verification are opt-in, on a disposable local container.

### What Unit 2 built (Unit 1 did NOT)

See Unit 2 below: the hypothesis and the student's confirmation, correction or rejection — still nothing persisted.

## Unit 2 — Hypothesis generation + student confirmation / correction

> **Superseded in part by Unit 3:** the statements below that "nothing is stored", that a response is "not consumed" and that a refresh regenerates the explanation describe Unit 2 as shipped. Unit 3 (below) persists the offer and the response once, replaces the stateless token, and ends regeneration-on-refresh.

> **Unit 2 introduces interpretation — but only as a hypothesis.** A model proposes ONE possible explanation from the Unit 1 observation evidence; the application decides whether it may reach a student; the student confirms, rejects or corrects it. The system never converts an inferred explanation into a confirmed diagnosis, and **nothing is persisted**: no diagnosis, no RepairPlan (Unit 3).

### The three layers (and where each lives)

```
OBSERVATION        what was recorded?                  Unit 1  buildObservationEvidence()      "What was recorded" card
   ▼
HYPOTHESIS         what might explain the pattern?     Unit 2  generateObservationHypothesis()  "A possible explanation" card (a guess, labelled as one)
   ▼
CONFIRMATION       what does the STUDENT say?          Unit 2  applyConfirmationResponse()      confirm / reject / correct — returned, not stored
   ▼  (not built)
CONFIRMED DIAGNOSIS + RepairPlan persisted             Unit 3
```

`confirmed` means **"the student said this matches"** — not that a model proved a cause. A student's correction is the student's evidence, preserved exactly, and is not forced into any taxonomy.

### What already existed (inspected and reused)

`generateStructured()` and the `autopsy-hypothesis` task + schema (`@ipmat/ai`), `AutopsyHypothesis` / `ConfirmationResponse` / `applyConfirmationResponse()` (the confirmation state machine: `awaiting_confirmation` is the only status a generator can produce; once answered it is terminal), `FixtureProvider`, `AnthropicProvider`, and the Unit 1 evidence. The older `generateHypothesis()` takes the full `AutopsyOutput` (candidate error category from the taxonomy); Unit 2 instead feeds the **Unit 1 observation evidence**, so it is a sibling entry point (`generateObservationHypothesis()`), not a rewrite.

### Responsibilities

| Layer | Owns |
|---|---|
| **Model** | proposes one possibility from numbered observed facts; nothing else. It is given no correct answer, no question text, no psychological field; unknowns are listed as unknown. |
| **Application** (`@ipmat/autopsy` `validateHypothesisCandidate()`, deterministic) | the safety contract: the explanation must be phrased as a possibility; must not state a cause or certainty ("definitely", "because you", "you misunderstood"); must contain no private-thought or psychological claim ("you thought/knew/felt…", unsure, confused, careless, guessed, confidence, effort, "understand…"); **every supporting-evidence entry must be one of the numbered observed facts, quoted verbatim** — an unsupported claim rejects the whole proposal, and what reaches the student is the verbatim fact, never the model's paraphrase. |
| **`@ipmat/practice-api`** | ownership; nothing before submission; fallbacks (below); the stateless confirmation token; applying the student's response through `applyConfirmationResponse()`; the student-safe view (no `modelConfidence`, no metadata, no error category). |
| **`apps/api`** | the model + sealing configuration (fail-closed), the HTTP routes. |

### Evidence inputs

The numbered facts are the same sentences as the "What was recorded" card (`describeObservationEvidence()` is now the single source of that wording), plus one generic sentence — "This question was designed around a common wrong-answer pattern." — when the question has a designed trap. The trap's **name stays internal**: it goes to the model in a separate section marked *do not quote this label*, because taxonomy names such as "…_confusion" or "careless_…" describe a question's design, not the student, and must not be put in front of a student. Unknown stays unknown: e.g. answer changes are unrecorded in this flow, so the model is told so and a hypothesis that cites "you changed your answer" is rejected as unsupported. The hypothesis is generated only for a **submitted, incorrect** attempt (correct/skipped/abandoned: `not_applicable`, and the model is never called).

### API

- `POST /v1/attempts/:id/hypothesis` → `{status: "ready", attemptId, hypothesis: {summary, supportingEvidence[]}, token}` | `{status: "not_applicable" | "unavailable", attemptId}`.
- `POST /v1/attempts/:id/hypothesis/response` with `{token, response: "confirmed" | "rejected" | "corrected", correctedExplanation?}` → `{attemptId, status, studentCorrectionText, hypothesisSummary, persisted: false}`.
- Both: auth required (401), another student's attempt is refused (403), an attempt still in progress is refused (409 — nothing before submission), an unknown attempt is 404. A correction must be 1–500 characters; bad input is 400.

### Confirmation and correction semantics

- **Confirm** → `confirmed`. **Reject** (no words) → `rejected`, never confirmed. **Correct** (the student's own words) → `corrected`, returned **exactly as typed** (spacing, line breaks, unicode); the proposal is never overwritten. In the UI, "No, something else happened" reveals an optional free-text box; sending it empty is a plain rejection.
- **The token (no stored state).** Because nothing may be persisted, the exact hypothesis that was shown rides in an opaque, server-sealed token (AES-256-GCM: unreadable and unforgeable by the client) bound to the student and attempt with a 6-hour expiry. The response is applied to precisely what the student saw; a garbage, altered, foreign-secret, expired, or other-student/other-attempt token is refused; a pre-confirmed hypothesis can never be smuggled in (`isTokenPayload` requires `awaiting_confirmation`). Every instance that may answer a response must share `IPMAT_HYPOTHESIS_SECRET`; with it unset a random per-process secret is used (safe: a token from another process is refused and the student is offered a new explanation).
- Because nothing is stored, **a response is not consumed**: answering twice returns the same result, and "confirm then reject" with one token is possible. Enforcing once-only is part of Unit 3's persistence. If the student never answers, nothing is recorded — the hypothesis simply remains unanswered.

### AI failure behavior

Every failure to produce a safe hypothesis — no model configured, a provider error or timeout, malformed / schema-invalid output, an unsafe or ungrounded proposal, a mismatched attempt id — answers `unavailable` and **nothing else**: no fabricated text, no raw model output, no error detail. The UI then shows "We couldn't suggest an explanation this time. You can carry on." The result, the recorded evidence and Continue are unaffected.

### Model configuration (explicit, fail-closed)

`IPMAT_AI_PROVIDER`: unset/`none` → no model (offers are `unavailable`); `anthropic` → the real provider, **requires `ANTHROPIC_API_KEY` and an explicit `IPMAT_AI_MODEL`** or the server refuses to start; `dev-scripted` → a development scaffold that quotes the observed facts — **it is not AI**, is refused when `NODE_ENV=production`, and exists only so the confirmation flow can be exercised end to end without a paid key. Anything else is a startup error.

### Persistence boundary — what Unit 2 does NOT persist

No `autopsies` row, no confirmed diagnosis, no RepairPlan, no mastery row, no attempt change (verified in tests, on real Postgres, and in the browser). `GET /v1/attempts/:id/autopsy` still reports nothing pending. The existing "see what the system noticed" screen and its un-wired respond path are unchanged.

### Student-facing flow

Result screen, after submission only: **What was recorded** → **A possible explanation** (for an incorrect answer): the label *"This is a guess based on what was recorded — not a fact"*, the proposal, *"What it is based on"* (verbatim recorded facts), *"Is that what happened?"* with **Yes, that's what happened** / **No, something else happened** (→ optional *"What happened instead?"* + **Send my answer**). After answering, a neutral acknowledgement ("Thanks. You said this matches what happened." / "…isn't what happened." / "Here is what you told us:" + the exact words) and "Your answer is only used on this page for now." Continue is always available.

### Psychological-inference and leakage guards

The system prompt forbids the claims; the validator enforces it on the output; the verbatim-fact rule bounds what can be cited; the student sees no `modelConfidence`, model, provider, prompt, error category or metadata; the pre-submission question page has no explanation and the API refuses it; the explanation text is the model's only free text and is scanned before it can be shown. Tests cover each rejection class (certainty, cause, non-possibility, private thought, emotion/state, confidence, carelessness, ability, effort, too short, unsupported evidence, malformed JSON, empty, wrong shape, provider error, timeout).

### Tests

- `@ipmat/autopsy` `observationHypothesis.test.ts` (**27**, fixture provider, no live model): valid proposal; verbatim grounding; prompt contents (facts, unknowns, no key, no psychology); missing evidence not invented; 11 unsafe-explanation classes; unsupported/empty evidence; malformed outputs; provider error and timeout; sanitising of internal notes; every rejection reason; no AI call for correct/skipped/abandoned; confirm / reject / correct (exact, unmutated, single-use) semantics.
- `@ipmat/practice-api` `hypothesis.test.ts` (**16**, through the real attempt lifecycle): the offer is built from the Unit 1 evidence and is student-safe; not_applicable without a model call; 409 before submission; ownership; every AI-failure path → `unavailable`; the result is unaffected; confirm / reject / correct exactly; idempotence; forged / altered / foreign-secret / expired / replayed-by-another-student / moved-to-another-attempt tokens refused; no response before submission; malformed responses 400; nothing written; no RepairPlan/diagnosis dependency exists.
- `apps/api` `hypothesis.test.ts` (**11**): fail-closed configuration; the sealed token (round-trip, confidential, tamper-proof, shared-secret across instances); the real HTTP path (409 before, ready after, confirm/reject/correct, 400s, 401/403/404, second instance with the shared secret honors a token, another secret refuses it, no model → unavailable while result and evidence still work).
- `apps/web` `possibleExplanation.test.ts` (**12**): the adapter's strict mapping (ready / unavailable / not_applicable / malformed / refused; a correction sent exactly; identity never in the body); the component's loading state, guess framing, wording, and slot in the result screen; only an incorrect submitted result gets the card.
- Real Postgres (**+4**, opt-in): see Validation.
- Changed existing tests: the Unit 1 evidence guards (the new `designedTrapCode` metadata field).

### Validation

Default suite (no database): full repository **2078 passed + 54 skipped** across 197 files (was 2012 + 50); the 54 skipped are the opt-in real-database suite, run separately on real Postgres: **54/54 passed** (was 50). New tests: autopsy +27, practice-api +16, api +11, web +12, real-Postgres +4. Typecheck (all workspaces), build, lint and `git diff --check` clean. No model was called by any test.

**Real PostgreSQL** (same disposable-container procedure as before: `postgres:16-alpine` on `127.0.0.1:55432`, random throwaway password never written to the repo, database `ipmat_test`; the unrelated Postgres on 5432 was not touched), through the real HTTP server on the real Prisma repositories, with the dev-scripted scaffold as the model: a hypothesis is built from the persisted attempt's evidence and the **original, a restarted and a second instance offer the same one**; a token issued by one instance is honored by the restarted and the second instance (shared secret, no stored state); confirm / reject / correct return the right status and the correction exactly; offering and answering leave `autopsies`, `repair_plans`, `mastery_states` and the attempt row (and its events) unchanged, and `/autopsy` still reports nothing pending; 409 before submission, 403 for another student (offer and response), 401 without a session, 409 for garbage/altered tokens and for a token moved to another attempt; `not_applicable` for correct and skipped attempts; an instance with no model answers `unavailable` while result, evidence and recommendation still work.

**Browser verification** (raw CDP / headless Edge; real `apps/web` + real `apps/api` in Prisma mode + the disposable Postgres; the model is the dev-scripted scaffold, **not AI**; no fixture adapter): **22/22 checks.**
1. **Incorrect → confirm, with an API restart in between:** before submission there is no explanation card; after submitting, "What was recorded" shows first, then "A possible explanation", labelled *"This is a guess based on what was recorded — not a fact"*, possibility-phrased, citing only recorded facts (verbatim) and the generic design sentence, with "Yes, that's what happened" / "No, something else happened"; no model internals, `undefined`/object leakage, answer-key field or psychological wording in the page. The API process was **killed and restarted**, and confirming still worked (the sealed token is honored by the new process); the acknowledgement states only what the student said, and no autopsy, RepairPlan or mastery row exists; Continue works.
2. **Reject / correct:** "No" reveals an optional free-text box with no preset categories; the student's correction (including a line break, "—" and "✓") is shown back **exactly as typed**; sending it empty is a plain rejection (not shown as a confirmation); nothing persisted.
3. **Correct and skipped attempts** show recorded evidence but no explanation; **a refresh** offers the explanation again (nothing was stored), unconfirmed, identical for the same evidence.
4. **AI unavailable** (API restarted with no model configured): "We couldn't suggest an explanation this time. You can carry on." instead of any explanation; the result, the recorded evidence and Continue are intact; nothing created in the database.

### Limitations

- **No real model was exercised.** No `ANTHROPIC_API_KEY` exists in this environment. Everything above ran with fixture providers and the dev-scripted scaffold (which is not AI); the real-provider path (`AnthropicProvider` through `generateObservationHypothesis()`) is typechecked and reached by configuration but **unverified against a live model**, including how often a real model's output passes the strict validator (it is deliberately strict — failures fall back to "unavailable"). An opt-in smoke test against a real key is the missing step.
- **Hypothesis quality is limited by its inputs.** The model sees only observed facts and the (internal) designed-trap label; it does not see the question text, the options or the correct answer, so proposals will be generic.
- **Nothing is stored, so a refresh regenerates** the explanation (a new model call each time the result of an incorrect attempt is opened) and an answered response is not remembered. Persistence, caching and once-only enforcement are Unit 3.
- **A response is not consumed** (stateless token): see above.
- The validator is lexical (patterns and verbatim matching); it cannot judge whether a well-formed, grounded proposal is *correct*, only that it is safe in form. The student's confirmation is what makes it meaningful.
- Answer changes, hints and solution opening remain effectively unobserved in the current flow (Unit 1 limitation).
- Real-database and browser verification are opt-in, on a disposable local container.

## Unit 3 — Persist the confirmed diagnosis + RepairPlan

> **Unit 3 makes the student's answer durable — and nothing else.** The offered explanation is stored; the student's response is stored once; only a student-CONFIRMED explanation becomes a diagnosis, and only then is exactly one RepairPlan created. No question is selected, ranked or scored for repair (Unit 4).

### Lifecycle

```
Observation evidence   Unit 1   derived on every read
      v
Hypothesis (offer)     Unit 2   generated once -> PERSISTED (Unit 3): autopsies row, confirmed = NULL ("awaiting")
      v
Student response       Unit 3   confirm | reject | correct -- recorded ONCE (first response wins)
      v
Confirmed diagnosis    Unit 3   only for "confirm": autopsies.confirmed = true, confirmed_at = response time
      v
RepairPlan             Unit 3   only for "confirm": one repair_plans row, built by the existing buildRepairPlan()
```

### The three outcomes

| Student does | `autopsies` row | RepairPlan | API `diagnosis.state` | UI text |
|---|---|---|---|---|
| **Confirm** | `confirmed = true`, `confirmed_at` | exactly one (if a structured target exists) | `confirmed` | "Recorded as a confirmed explanation." + practice focus |
| **Reject** (no correction) | `confirmed = false`, no correction text | none | `not_confirmed` | "This explanation was not confirmed." |
| **Correct** (own words) | `confirmed = false`, `student_correction_text` = the exact words | none | `awaiting_diagnosis` | "Your correction was recorded." + the words, exactly |

The status is derived from the one authoritative pair (`confirmed`, correction text), exactly as the existing `toAutopsyPersistenceRecord()` mapping defines it — no new column, no new table.

**Correction is not a diagnosis.** A free-text correction has no structured category to target; turning it into one needs a further diagnosis pass (D-039: `buildRepairPlan()` refuses anything but `confirmationStatus === "confirmed"`). Unit 3 stores the words and stops. The state name `awaiting_diagnosis` marks exactly that boundary; no code produces a diagnosis from it yet.

**Confirmed but no target.** If the question has no resolvable designed trap (no `trapErrorTaxonomyCode`, or the taxonomy cannot resolve it), the confirmation is still recorded but no plan is invented (`repairPlan: null`).

### Where the category comes from

The hypothesis's `proposedErrorCategory` — what a RepairPlan targets — is the question's **designed** trap category (question metadata resolved through the existing `ErrorTaxonomy`), never the model's own pick. `generateObservationHypothesis()` now takes `designedErrorCategory` and the model's category field is ignored. The dev-scripted scaffold therefore produces plan-capable hypotheses without pretending to be a model.

### Once-only, enforced by the database

- `autopsies.attempt_id` is unique → at most one offer per attempt; a racing second offer finds the first (`created: false`).
- `respond()` is one transaction: `UPDATE autopsies SET … WHERE attempt_id = ? AND confirmed IS NULL`. Exactly one caller can win; only the winner creates the RepairPlan. A loser changes nothing and gets the persisted state (`alreadyRecorded: true`).
- **Migration `0011_one_repair_plan_per_autopsy`**: `repair_plans.autopsy_id` becomes UNIQUE (replacing a plain index; `Autopsy.repairPlans` → `repairPlan?`). Even a bug could not create a second plan for one autopsy. This is the only schema change; verified with `prisma migrate deploy` and `prisma migrate diff` (no drift) on a disposable Postgres.
- **Repeat semantics**: the same response again, a different response (confirm→reject, reject→confirm), another instance, or 12 concurrent requests across two instances all return the persisted result; the first response (and its timestamp) stands. A repeat is not an error.

### Token and trust

The server-sealed token (AES-256-GCM, shared secret) no longer carries the hypothesis; it binds `studentId`, `attemptId`, the stored offer's id and its exact text, and an expiry (6 h). On a response the server verifies: the claim's student and attempt match the token (403 otherwise), the token opens and is unexpired and in the v2 format (409 `invalid_state` otherwise), and the **stored** offer still has that id and text. The stored offer is the source of truth; the client cannot alter the hypothesis, the diagnosis, the attempt, the student, or any provenance. The offer itself never expires: a student who returns later is handed a fresh token for the same stored offer (no new model call), or the stored answer if already answered.

### Provenance

- The stored offer keeps the Unit 1 observation evidence it was generated from (`evidence_used.observationEvidence`) plus the hypothesis's supporting/contradictory/missing evidence, provider and prompt version.
- The `repair_plans` row links autopsy (→ attempt, evidence package, hypothesis) and student; `confirmed_at` is the student's confirmation. `follow_up_question_ids` is empty by design.
- None of this is exposed to the student: the API returns only status, the student's own words, the hypothesis summary, and — for a confirmed one — `{conceptName, patternFamilyName, status}`.

### API

- `POST /v1/attempts/:id/hypothesis` → `ready` (stored offer + fresh token) | `answered` (the persisted result) | `not_applicable` | `unavailable`. Nothing before submission (409), another student's attempt 403, unknown 404.
- `POST /v1/attempts/:id/hypothesis/response` → `{ status, studentCorrectionText, hypothesisSummary, persisted: true, alreadyRecorded, diagnosis: { state }, repairPlan | null }`.

### UI

Confirm → "Recorded as a confirmed explanation." + "Practice focus: <pattern> in <concept>." Reject → "This explanation was not confirmed." Correct → "Your correction was recorded." + the exact words + a note that they are not treated as a confirmed explanation. The state survives reload and API restart (the card reads the stored answer). The result screen's Continue is unchanged; the legacy "see what the system noticed" detour no longer replaces it (a persisted offer exists for every incorrect attempt).

### Observed effect on recommendations (reported, not built)

The existing composition already reads confirmed, active RepairPlans, and the existing orchestrator's repair tier already consumes them. Unit 3 changed none of that code; it simply means a stored confirmed plan now exists to read. In the browser, after confirming, the next recommendation reads "Fix a confirmed mistake pattern" (that existing tier's copy: "You confirmed a specific mistake last time — here's a question to test whether you've corrected it."); after reject/correct it is unchanged ("Try a related question"). This is pre-existing behavior reaching real data for the first time. Which question the repair tier picks is **not** targeted repair selection and has not been reviewed for repair quality — that is Unit 4.

### Failure and retry semantics

- Model failure / unsafe output / no model / no store: `unavailable`; nothing stored, nothing fabricated; result and Continue unaffected.
- A failed response write: the client shows "We couldn't record that. Please try again."; nothing was recorded, and retrying is safe (the transaction is all-or-nothing, and a repeat returns the persisted result).
- Token expired or stale: 409; asking for the offer again returns the same stored offer with a fresh token.
- If a plan cannot be built for a confirmed explanation, the confirmation is kept and no plan exists (never a partial or placeholder plan).

### Tests

Domain/service (`packages/practice-api`, in-memory store with the Prisma contract): 26 tests covering persistence, exactly-one diagnosis/plan, reject/correct creating neither, exact correction, idempotency incl. 10 concurrent, forged/expired/moved/old-format tokens, ownership, unfinished attempts, provenance, student isolation, no psychological wording, no answer leakage, no Unit 4 behavior (no selection/mastery dependency). HTTP (`apps/api`): offer/confirm/reject/correct/once-only over the real server. Web: adapter mapping of the persisted outcomes and the honest wording. Real Postgres (`prismaPersistence.integration.test.ts`): offer persisted once; confirm → rows with provenance, duplicates (sequential, cross-instance, 12 concurrent) → one plan; reject and correct → no plan; DB constraints refuse a second plan/autopsy; restart and second-instance reconstruction; recommendation reads the stored plan and ignores reject/correct.

### Limitations (honest)

- **No real model has ever run** (no key). The offer comes from the development-scripted scaffold in browser/PG runs; the validator's strictness against real output is unmeasured. `npm run smoke:anthropic` remains the opt-in check.
- The correction text is stored but never analysed; "awaiting_diagnosis" has no consumer yet.
- A confirmed plan's `followUpQuestionIds` is empty; repair-question selection does not exist.
- Plan `status` never leaves `pending` (nothing advances it yet).
- The in-memory development store mirrors the contract but with stand-in ids; the database path is the verified one.

### What Unit 4 will build (and Unit 3 did NOT)

Unit 4 — **targeted repair-question selection and adaptive integration**: choose, rank and explain follow-up questions for a stored confirmed RepairPlan; define how a plan advances (`pending → in_progress → completed`); decide how plan-driven selection interacts with the existing adaptive tiers (and whether the repair tier's current behavior should be kept, changed or gated); consume the stored correction text only via a future diagnosis pass. **Unit 4 has NOT been started.**
