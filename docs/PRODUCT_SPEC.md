# Product Spec

## 1. What this product is

An AI-native mastery platform for Indian competitive exams. It does not just teach syllabus — it trains students to handle the **legitimate ways an exam can test a concept**: standard application, combination with other topics, traps, unfamiliar representations, and time pressure. The system's job is to get a student *exam-ready*, which is a broader and more precise claim than "syllabus complete."

The platform is designed to eventually cover CAT, CUET, CLAT, JEE, NEET, SSC, Banking, GATE, UPSC and others, but nothing in this phase builds toward that breadth directly. It builds one vertical slice deep enough that the pattern generalizes later without a rewrite.

## 2. First vertical slice (the only thing being built now)

```
IPMAT → Quant → Percentages
  → Concept Universe
  → Examiner Lens
  → Question Universe
  → Question DNA
  → Question Generation
  → Validation
  → Student Attempt
  → Question Autopsy
  → Targeted Repair
  → Mastery
```

Every architectural decision in this repo is judged by one question: **does it make this slice work end-to-end for one exam, one subject, one chapter, one concept** — in a shape that generalizes to the next chapter without redesign? Breadth is explicitly deferred (see [MASTER_PLAN.md](MASTER_PLAN.md) §"Not building yet").

## 3. The five readiness distinctions

The product must be able to separately measure and report:

| Dimension | What it answers | Not the same as |
|---|---|---|
| Syllabus completion | Has the student seen the material? | Mastery |
| Concept mastery | Can the student apply the concept correctly, observed over attempts? | Confidence (never measured — see §7) |
| Question-pattern coverage | Has the student handled the known legitimate ways this concept is tested? | Volume of questions done |
| Advanced readiness | Can the student handle above-exam-difficulty, trap, and novel-presentation versions? | Standard-difficulty accuracy |
| Speed / accuracy / novelty-handling / pressure performance | Four independently tracked, observable performance axes | A single blended "score" |

These are stored as distinct, queryable facts per (student, concept), not folded into one number. See [DATABASE.md](DATABASE.md) §MasteryState.

## 4. Core differentiators, translated into system behavior

### 4.1 Concept Universe
A concept (e.g. Percentages) is a node in a graph, not a leaf in a syllabus tree. The graph carries typed edges: `prerequisite_of`, `related_to`, `combines_with`. Percentages ↔ Ratio ↔ Averages ↔ Profit/Loss ↔ Discount ↔ DI ↔ Algebra is literally an edge list, not prose. See [QUESTION_ENGINE.md](QUESTION_ENGINE.md) §1.

### 4.2 Examiner Lens
A structured, schema-validated analysis artifact — not a generation shortcut. Given a concept (or a specific question), it answers: what is actually tested, what prerequisites are exercised, what legitimate patterns can test it, what transformations apply, what combinations are valid, what traps are legitimate (not just "make it harder"), and what unfamiliar representations are possible. This artifact is a first-class, versioned, stored object — every generated question must trace back to the Examiner Lens analysis cell it was generated from. See [QUESTION_ENGINE.md](QUESTION_ENGINE.md) §2.

### 4.3 Question Universe
The system maps the *meaningful* pattern space for a concept — families, combinations, transformations, traps, difficulty levels, speed requirements, novel presentations — as an explicit taxonomy with coverage tracking. It never claims mathematical completeness; it claims and tracks **coverage against a curated, explainable taxonomy**. Coverage gaps are visible and queryable, not implicit. See [QUESTION_ENGINE.md](QUESTION_ENGINE.md) §3.

### 4.4 Question DNA
Every question is metadata-complete before it is servable: exam, section, subject, chapter, concept, subconcepts, prerequisites, pattern, skill, difficulty dimensions, expected time, trap type, transformation, source/provenance, validation state. This is a schema, not a convention — see [DATABASE.md](DATABASE.md) §Question / QuestionDNA.

### 4.5 Question Autopsy
On a wrong answer, the system forms a **hypothesis**, not a verdict: "Your working suggests you may have treated X as Y — is that what happened?" It never claims to know the student's thoughts. The student confirms or corrects; a correction is captured (text now, voice later) and feeds the diagnosis and, over time, the hypothesis-generation prompt itself. Confirmed diagnosis drives targeted repair questions. See [QUESTION_ENGINE.md](QUESTION_ENGINE.md) §5 and [AI_ARCHITECTURE.md](AI_ARCHITECTURE.md) §4.

### 4.6 Overtraining
Difficulty tiers — Standard, Advanced, Hard, Extreme, Novel — are exposure levels above expected exam difficulty, not nonsense generators. "Hard" must still be valid, syllabus-relevant, unambiguous, and correct. Validation gates this explicitly (see [QUESTION_ENGINE.md](QUESTION_ENGINE.md) §4); a question that fails validity/unambiguity checks is rejected regardless of how "interesting" its difficulty is.

### 4.7 Surprise / Trap / Pressure, Calculation Gym, Vocabulary Gym
All explicitly out of scope for this phase (see [MASTER_PLAN.md](MASTER_PLAN.md)). They are named here only so the Question DNA schema and concept graph are shaped to not block them later (e.g. `trap_type` and `expected_time` already exist on every question).

### 4.8 Calendar-aware preparation, decoupled from mastery
Two independent axes, never merged:
- **Prep phase**: a pure function of `(enrollment_date, exam_date, today)` producing an expected coverage curve for the exam. This is a content/pacing default, not a measurement.
- **Demonstrated mastery**: purely observed, per concept, from attempts.

A late joiner gets a **catch-up layer** — a per-student overlay that compresses/reorders the expected coverage curve — without mutating the phase template itself, and without the system pretending the student's mastery is different because they joined late. See [DATABASE.md](DATABASE.md) §PrepPhase / CatchUpPlan.

## 5. Explicit product rules (non-negotiable)

- **No confidence score.** The system measures observable performance only (accuracy, speed, retries, hint use, time-vs-expected). It never claims to infer how confident, anxious, or certain a student *feels*.
- **No fake AI.** If a feature is described to the student as AI-driven, it must be. No hard-coded "analysis" dressed up as a model response.
- **No fake analytics.** Dashboards show real, derived-from-attempts numbers, or they show nothing.
- **No hard-coded exam rules or pricing.** Exam structure (sections, timing, marking scheme) and pricing are data, not code — even though only IPMAT exists today.
- **Content provenance is mandatory.** Every piece of content (question, explanation, passage) carries a `source_type` ∈ {original, licensed, public_domain, open_license, official, user_authorized}. No pirated coaching material, PDFs, or Telegram-dump content, ever. This is enforced at the schema level (a question cannot be published without a provenance record), not just policy.

## 6. Primary user (this phase)

A single student persona: an IPMAT Indore aspirant working through Percentages. No parent portal, no coaching-admin console, no multi-tenant org model yet — those are shaped for in the domain model (see [DATABASE.md](DATABASE.md)) but not built.
