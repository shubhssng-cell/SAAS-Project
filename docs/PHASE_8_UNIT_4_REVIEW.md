# Phase 8 Unit 4 — Deep Personalization

Decision record: [DECISIONS.md D-095](DECISIONS.md). Code: `packages/domain/personalization` (`@ipmat/personalization`, pure) and additive presentation support in `packages/domain/tutor` and `packages/ai`. **No migration, no table, no route, no UI, no second provider, no second selection engine, no profile, no score.**

## 1. Specification audit

**A. Explicitly specified:** nothing about personalization or preferences. The one relevant statement is the opposite: `docs/project-memory/20_STUDENT_MODEL.md` — "no profile, no self-reported data, no preferences"; `Student` carries only identity and onboarding columns. What IS specified and constrains this unit: no confidence/emotion/intelligence/motivation inference (D-005, D-006 and every later extension), student-facing copy states observations only, selection is the existing orchestrator's (D-062), official simulations carry no exam rule of their own and accommodations are unspecified (D-090), and the tutor's key/grounding/ownership rules (D-092–D-094).

**B. Safely composable (implemented):** a minimal explicit preference contract (necessary, because none exists); a deterministic mapping from those preferences to the tutor's **presentation** (language, length) and to which existing **tutor intent** to start with; a read-only view; per-decision INPUT → RULE → OUTPUT records; pass-through reports for curriculum and revision; a stated "never personalized" report for simulations.

**C. Unresolved (not invented):** any preference that constrains question selection (none is defined and `TrainingCandidateQuestion` carries no field one could act on); a difficulty preference and how it would reconcile with adaptive evidence; pacing / practice-intensity preferences (no mechanics exist for them); interface preferences (no UI); durable storage and the surface that writes preferences; accommodations; terminology translation rules; any evidence-driven personalization rule.

## 2. The four kinds of information, kept apart

| Kind | Example | Where it lives | Used by personalization? |
|---|---|---|---|
| Explicit preference | language = Hindi | `StudentPreferences` | **Yes — the only input** |
| Observable training evidence | 12 attempts, 3 distinct questions | attempts / mastery evidence | **No** (no personalization rule reads it) |
| Derived training signal | a revision signal, an adaptive recommendation | existing engines | passed through verbatim, never altered |
| Psychological / latent attribute | anxious, low confidence, learning style | **nowhere** | **Never inferred, stored or output** |

This is enforced by data shape, not by comments: validation refuses any such field by name (`inferred_attribute_not_allowed`), the stored record can contain only the three explicit fields, and tests walk the keys of every preference, decision, report, view and presentation looking for trait vocabulary.

## 3. Preference model

`StudentPreferences { language | verbosity | preferredHelp }`, each nullable (`null` = no preference, existing behaviour).
- `language`: `english | hindi | hinglish` — wording of the tutor's answer.
- `verbosity`: `concise | standard | detailed` — length of the tutor's answer, never what it may reveal.
- `preferredHelp`: `hint | guided_question | explanation` — which existing tutor intent to start with when the student asks for "help" without naming one.

No "learning style" categories exist. Validation is strict (unknown, non-explicit and trait-like keys refused, values enumerated); a patch changes only the fields it names; `null` clears one. `PreferenceStore` is keyed strictly by an ownership-verified student id with no list/find-by-value; the only implementation is in-memory (the test double). **No durable store is built**: nothing in the product can set a preference yet (no route or settings screen), so a table would be storage without a writer. A persistent store must implement the same port; its minimal schema would be one row per student with these three nullable columns. That is a product decision recorded as unresolved.

## 4. Personalization rules (deterministic, no weights)

`LANG-1`, `VERB-1`, `PRES-0` (a presentation stated on the request wins over a stored preference), `HELP-0` (an explicit intent wins over a stored preference), `HELP-1`, `HELP-2` (the mapped intent's own policy governs disclosure), `CURR-0`, `REV-0`, `SIM-0`, `DEFAULT-0` (no applicable preference → existing behaviour). Every decision is `{dimension, rule, input, effect, limitedBy, output}` and renders as one sentence such as `language=hindi -> LANG-1: tutor language changed from english to hindi (…)`. There is no hidden rationale and no inference.

## 5. Tutor integration

The tutor receives a **two-field presentation** and nothing else about the student, so a preference cannot reach the answer-key rule, the context firewall, ownership, exam scope or grounding.
- **Default is byte-identical:** an absent presentation equals an explicit default (same context, same prompt, prompt version `tutor-response-v2`); a non-default presentation appends one `PRESENTATION` block and uses `tutor-response-v3`. Each instruction line says what it does not change.
- **Verbosity.** `concise` ⇒ only the parts the mode's contract requires (a deterministic check, `verbosity_violation`; required parts are never dropped). `detailed` ⇒ the optional `tryNext` part is allowed within the same caps. `standard` ⇒ existing behaviour.
- **Language.** The model returns the canonical English `text` — validated by the full Unit 1–3 validator, unchanged — and a `localizedText`. The localized text is an **add-on validated on its own** and **dropped (English shown) if it fails**: a good translation never rescues a bad English answer, and a bad one never blocks a good English answer. Its checks: script matches the request (Devanagari for Hindi, none for Hinglish); the withheld key never appears as a whole token (stricter than English: no verdict word is needed); authored solution steps are not reproduced; no identifier, internal token or other-exam name; **every number in it already occurs in the English answer or the supplied context** (a translation cannot add figures); plus a lexicon backstop (the English psychological / mastery-readiness / exam-rule lists, since Hinglish uses English loanwords, plus small Hindi and romanized-Hindi lists).
- **Honest limit:** the Hindi/Hinglish backstop is best-effort and non-semantic. Hindi, and especially romanized Hindi, has no standard spelling, so recall is lower than English (one real spelling gap — "tayyar" — was found by a test and fixed). A claim phrased in words the lists miss would not be detected in the localized text. That is why the English text is what was cleared, the localized text is a droppable presentation, and only the main message is localized (structured parts, the Socratic question and hypotheses stay English).
- **Help intent.** `resolveHelpIntent`: an explicit intent always wins; with none, the preference maps to `give_hint` / `guide_with_question` / `explain_question`; with none at all the caller must choose. **Conflict:** an "explanation" preference before a submitted attempt is recorded as `limited` by `answer_key_policy` — the tutor's policy wins and the key stays out of the prompt (tested through the real context builder).
- **Ownership.** `loadPreferencesForRequest` verifies the enrollment through the tutor's own port first; a missing and a foreign enrollment are one refusal and the preference store is not read.

## 6. Training, revision and curriculum

Personalization and adaptation stay distinct: what evidence calls for is decided by the existing engines; what a preference changes is decided here. No preference constrains selection today, so `personalizeCurriculum` / `personalizeRevision` return the existing result **by reference, unchanged**, plus a report (`altered: false`, `selectionAltered: false`, `presentationAltered: false`, and a `CURR-0`/`REV-0` decision saying why). Tests use the real pipeline (real orchestrator, evidence view, providers, revision intelligence, curriculum): the recommendation equals an independent recomputation for every one of 48 preference combinations, the next action stays inside the published, exam-scoped pool, and a deep-frozen result passes through untouched. Revision's `priority` stays `{ defined: false }`. A future selection preference would narrow the candidate pool **before** the existing orchestrator runs; it would never replace it or widen the pool beyond published, exam-scoped questions.

## 7. Simulation safeguards

`simulationPersonalization` returns `altered: false` and a `SIM-0` "not applied" decision for every preference that is set. The package does not depend on the simulation engine and the engine's types contain no preference field (both tested). Accommodations remain an unresolved product/legal policy (D-090).

## 8. Conflict handling

Resolved by named rules: concise vs required parts (VERB-1), preferred help vs key policy (HELP-2), stored preference vs explicit request (HELP-0/PRES-0), preference vs exam mechanics (SIM-0), language vs failed validation (LANG-1: English wins). **Unresolved and recorded as such:** language vs source terminology (C6), easier-questions preference vs adaptive evidence (C7 — no difficulty preference is offered because no rule exists to reconcile it), accommodations vs official timing (C8). No conflict is settled by a score.

## 9. Privacy and security

Student isolation (a request reads only its verified owner's record), enrollment ownership, exam isolation (the tutor scope is the enrollment's exam; preferences carry no exam), private preferences and decision/rule identifiers never enter a prompt (tested against an attacking `focus`), the view carries no ids and no evidence, and the answer-key rules are unchanged for every presentation (property-tested across all intents and all 9 presentations; a hostile model leaking the key is rejected for every preference set).

## 10. Unresolved personalization policies

Durable preference storage and the surface that writes it; any selection-constraining preference and its reconciliation with adaptive evidence; difficulty, pacing, practice-intensity and interface preferences; terminology translation; accommodations; evidence-driven personalization rules (none exist); whether a language preference should also localize fixed product copy (no i18n exists); whether `detailed` should raise any cap.

## 11. Known limitations

- No route, UI, settings screen or durable store: nothing can set a preference yet.
- Hindi/Hinglish validation is a best-effort backstop, deliberately weaker in recall than English.
- Localization covers the main message only; explanation parts, the Socratic question and hypotheses remain English.
- `preferredHelp` only chooses among existing intents; it does not change what any intent may reveal.
- No live model has run; localization quality (fluency, faithfulness) is unverified and not claimed.

## 12. Verification

| Check | Result |
|---|---|
| Focused tests | `@ipmat/personalization`: 4 files, 64 tests (preferences 21, integration/conflicts/simulation/view 25, seeded properties 9, boundary 5). Tutor presentation: 44 new tests in `presentation.test.ts`; tutor package 297 tests total, all Unit 1-3 tests passing with only two exact key-list assertions extended (`language` in the student view, `localizedText` in the model schema) |
| Mutation checks | disabling the localized key-token check made 2 tests fail; making the request always rewritten made 5 fail; both restored |
| Full suite, real Postgres 16 (disposable, `127.0.0.1:55432`, 5432 untouched, migrations 0001-0016 + seed) | 321 files, 7451 tests passed |
| Full suite, no Postgres | 299 files passed, 22 skipped (DB-only); 7180 tests passed, 271 skipped |
| Typecheck / lint / build / `git diff --check` | all clean (lint flagged 5 issues in the new tests, fixed) |
| HTTP | real API on Prisma persistence: signup/me work; `/v1/preferences`, `/v1/me/preferences`, `/v1/personalization`, `/v1/settings` and `/v1/tutor` are 404 for GET/POST/PUT (no route exists); no preference, rule-id, localized-text or personalization text in API or web responses |
| Browser | no browser-automation tool; headless Edge rendered the real web app (landing page; the only keyword matches were CSS `prefers-color-scheme` media queries). No click-through flow was run - no UI was added |
| Database / migration | none: `students` columns unchanged (`created_at, onboarding_completed_at, id, auth_ref, email, password_hash`), zero preference/personalization tables; the database and servers were removed |
| Live model | never run (no key) |

Defects found by verification and fixed: a Hinglish spelling gap in the readiness backstop ("tayyar", found by a test); the trait-name refusal missed "laziness" (found by a test); Unit 2's `stripControl` regex contained literal control bytes (now escapes; behaviour unchanged). One earlier verification attempt was stopped when the system ran low on memory and was re-run in full afterwards.
