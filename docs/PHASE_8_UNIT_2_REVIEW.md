# Phase 8 Unit 2 — Explanation + Socratic Teaching

Decision record: [DECISIONS.md D-093](DECISIONS.md). Builds on [Unit 1](PHASE_8_UNIT_1_REVIEW.md) / D-092. Code: `packages/domain/tutor` (`@ipmat/tutor`, pure; no new package) and the extended `tutor-response` schema in `packages/ai`. No route, no UI, no persistence, no migration, no second provider.

## 1. Specification audit (the Unit 1 unresolved list, re-checked against the repository)

Nothing new was specified since Unit 1 (`git log` shows no spec/doc commit after `1a12f4a`). Re-reading the existing specifications:

| Policy | Class | Finding |
|---|---|---|
| Hint levels and what each may reveal | **C — unresolved** | `hint_opened` (with an optional `hintIndex`) is an attempt-event name only. No hint text, hint field on `Question`, level count or ladder exists anywhere. |
| When an answer key may be shown | **A (partly) + B** | **Specified:** the practice result screen shows the correct answer and solution steps only for a **submitted** attempt, never for a skip (Phase 2 `AttemptResultView`). **Derived:** the tutor follows exactly that rule; Unit 1's looser "any finalized attempt" rule (it also admitted skipped/abandoned) was tightened to it. **Unresolved:** any reveal before a submission. |
| Which student evidence each intent may use | **B + C** | Derivable: the student's own submitted attempt, and their own autopsy outcome (confirm / reject / correct is specified, `RepairPlan` is confirmed-only — D-006/D-039). Unresolved: revision, curriculum, simulation, mastery evidence for the tutor — none is used. |
| Whether source text may be quoted | **C** | The corpus is internal and students are always denied by the retriever. Unchanged. |
| Conversation memory | **B (state) + C (policy)** | Prior interaction is accepted only as an explicit, validated, size-capped context object; nothing is stored. Any memory, ordering or escalation between modes is unresolved. |
| Rate limits / budgets | **C** | Unchanged (call count per request is bounded: ≤ 3 model calls from grounding retries). |
| Tone / reading level | **C** | Unchanged. |
| Student-facing display | **C** | Unchanged; `toStudentTutorView` remains the only shape, extended with mode, question and labelled parts. |
| Refusal auditing | **C** | Unchanged: `TutorError` refusals are still not audited. |

**Essential-and-undefined decision.** The hint **ladder** (levels/progression) is the one essential undefined policy. It was **not implemented**, as instructed: there is exactly one hint mode and no escalation of any kind. Everything else in Unit 2 is derivable from existing specification or is a conservative restriction.

## 2. Teaching architecture

Six **teaching states**, each its own contract in `policy.ts` (disclosure, context sections, required/forbidden content, length cap) — not different prompts:

| Mode | Intent | Key | Content contract |
|---|---|---|---|
| hint | `give_hint` | never | ≤ 500 chars (provisional); no worked parts |
| guided question | `guide_with_question` | never (even after submission) | one `socraticStep`; no parts; ≤ 500 chars |
| explanation | `explain_question` | after a submitted attempt | parts `asked`, `concept`, `takeaway`; plus `steps`, `whyCorrect` only when keyed; `steps`/`whyCorrect` **forbidden** while withheld |
| full solution | `clarify_solution` | after a submitted attempt (and authored steps required) | `asked`, `concept`, `steps`, `whyCorrect`, `takeaway` |
| mistake explanation | `explain_mistake` | after a submitted, incorrect attempt | `whyIncorrectPathFails`, `whyCorrect`, `takeaway`; hedged hypotheses allowed |
| concept clarification | `explain_concept` | never | `concept`, `takeaway` |

There is **no ladder**: no policy has a level, rank, next-mode or escalation field (tested). The mode is chosen by the intent only.

## 3. Hint policy

One hint mode. The key and solution are never in a hint prompt, before or after an attempt (matrix-tested for every attempt state). A hint that asserts the key, reproduces a solution step, carries worked parts or exceeds the cap is rejected. A **repeated** hint request is not escalated; an identical repeat of a caller-supplied prior action is refused (`repeated_teaching_action`), a different hint is accepted. A prior action can never widen disclosure.

## 4. Socratic behavior

A step is a deterministic **teaching action**: `{ checks, question, conceptRef, evidenceRefs, learnsFromReply }` (what fact is checked, the single question, the context concept, the evidence it rests on, what the reply would show). Validation: a step is required for the mode and forbidden elsewhere; the question must be a question and at most two `?`; `conceptRef` must be a `concept:` reference in the supplied context; evidence references must exist; the shown text must contain the question; no key, no psychological claim in any field. The recorded action holds these fields only — **never model reasoning**; extra model fields are stripped. The student view exposes only the question; `checks`/`learnsFromReply` stay internal. When the student has a submitted attempt, its observable facts and own autopsy outcome ground the question (student-work-first); with none, the question alone does.

## 5. Answer-reveal policy (explicit, matrix-tested)

`intent × attempt status {none, in_progress, submitted, skipped, abandoned}` is asserted cell by cell: the key block appears in a prompt **iff** the intent's policy is `after_submitted_attempt` and the attempt is `submitted`; `explain_mistake` / `clarify_solution` without a submitted attempt are `insufficient_context` **before any model call**. A skip never unlocks a walk-through. This tightens Unit 1 (see D-093) to match the practice result screen; it is conservative, not a new product rule.

## 6. Mistake teaching (Phase 4 integration)

A new `TutorDiagnosisPort` supplies the student's **own** autopsy outcome for the attempt, already in student-facing wording (label, hypothesis as worded to the student, the student's correction, a confirmed repair-target label). It has no rationale, evidence list, model confidence or taxonomy-code field; an internal code, if given, is leak-check-only.
- **awaiting confirmation** → enters only as a hypothesis; the answer **must** put it to the student as a hedged hypothesis/question (`unconfirmed_diagnosis_not_queried`); claiming "you confirmed…" or stating a cause is rejected (`unconfirmed_diagnosis_as_fact`).
- **confirmed** → may be built on and its repair-target label named; a repair target is ignored under any other status.
- **rejected** → the rejected wording never reaches the prompt; a response repeating it is rejected (`rejected_diagnosis_reused`).
- **corrected** → the student's own words are used; the original wording is excluded and checked.
- A diagnosis of another student or another attempt is refused. Only `explain_mistake` and `guide_with_question` receive a diagnosis; no other mode does. The tutor never confirms, rejects or writes a diagnosis, mastery or repair row.

## 7. Grounding (strengthened; still deterministic and non-semantic)

Added to Unit 1's checks: teaching-mode contract (required/forbidden parts, Socratic validity, length cap), key consistency (a stated correct answer must equal the authored key; another option may not be called correct), diagnosis status rules, repeated-action refusal, parts text included in every text check (psychological, mastery/readiness, rules, identifiers, leakage). **Limitation stated plainly:** the validator checks against the supplied structured context and policy; it does **not** prove mathematical truth. A fluent wrong derivation that states no answer, relation or rule is not detectable (a test documents this).

## 8. Security

Preserved from Unit 1 and re-tested for every new mode: student/enrollment/exam/question isolation, no key leakage, no internal ids to the model, no cross-exam data, no chain-of-thought. New: attacking `focus`, `priorInteraction` text and student replies change nothing in the context but the quoted line (equality-tested across all intents), cannot close their delimiter, and when a deliberately compliant model double leaks the key, a solution step, an internal code, another student's id or an exam rule, deterministic validation rejects it with no model text returned; the honest "not available" answer is accepted. Context budget is tested: exactly the policy's sections per intent, no mastery/revision/curriculum/simulation/readiness content, bounded graph/prior/focus, and an unrelated-history invariance test.

## 9. Limitations

- Prompt version bumped to `tutor-response-v2`; no live model has run (no key) — all behaviour is proven on deterministic doubles, not on real model compliance.
- Lexicons and the key-assertion check remain non-semantic and over-reject by design.
- The tutor never advances a student between modes; callers decide what to ask next. No UI/route; nothing calls the tutor yet; no Prisma-backed ports (including the diagnosis port).
- Length caps (500 characters) and the two-`?` rule are PROVISIONAL.

## 10. Unresolved tutor policies (carried in `UNRESOLVED_TUTOR_POLICIES`)

Hint levels and content; any pre-attempt reveal; revision/curriculum/simulation/mastery evidence for the tutor; quoting source text; memory/escalation between modes; rate limits and budgets; tone and reading level; display/reporting of a tutor answer; auditing refused requests; whether a tutor reply may open or confirm an autopsy hypothesis.

## 11. Verification

| Check | Result |
|---|---|
| Focused tutor + `@ipmat/ai` tests | tutor: 8 files, 253 tests passed (Unit 1 files updated to the stricter contracts; Unit 2: teaching 84, teaching security 30, teaching properties 6; Unit 1 files: context 32, grounding 49, service 34, boundary 11, properties 7) |
| Mutation check | letting `give_hint` receive the key made 23 tests fail; reverted, 253 pass |
| Full suite, real Postgres 16 (disposable, `127.0.0.1:55432`, 5432 untouched, migrations 0001-0016 + seed) | 311 files, 7237 tests passed |
| Full suite, no Postgres | 290 files passed, 21 skipped (DB-only); 6974 tests passed, 263 skipped |
| Typecheck / lint / build | all clean (one unused constant removed after lint flagged it) |
| `git diff --check` | clean |
| HTTP | real API on Prisma persistence: signup/me work; every `/v1/tutor*` path is 404 (no route exists); no tutor/Socratic/key text in API or web responses |
| Browser | no browser-automation tool; headless Edge rendered the real web app (landing page; the only keyword match was a `.form-error` CSS class). No click-through flow was run - no UI was added |
| Migration | none; the disposable database and servers were removed |
| Live model | never run (no key) |

Note: the first verification attempt was interrupted when the system ran low on memory; every check above was re-run from scratch afterwards, one at a time.

