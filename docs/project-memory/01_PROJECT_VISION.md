# 01 — Project Vision

> Part of the [project memory](00_MASTER_CONTEXT.md). Source: `docs/PRODUCT_SPEC.md` §1-2, §6 (read in full for this reconstruction).

## What this product is, verbatim from the product spec

"An AI-native mastery platform for Indian competitive exams. It does not just teach syllabus — it trains students to handle the legitimate ways an exam can test a concept: standard application, combination with other topics, traps, unfamiliar representations, and time pressure. The system's job is to get a student *exam-ready*, which is a broader and more precise claim than 'syllabus complete.'"

The platform is designed to eventually cover CAT, CUET, CLAT, JEE, NEET, SSC, Banking, GATE, UPSC and others — **but nothing in the current phase builds toward that breadth directly.** It builds one vertical slice deep enough that the pattern generalizes later without a rewrite. See [03_MVP_SCOPE.md](03_MVP_SCOPE.md).

## The educational problem being addressed

*(Reconstructed context — this framing is not written explicitly as a standalone "problem statement" document anywhere in the repository; it is synthesized from the product spec's differentiators (§4) and the non-negotiable rules (§5), which only make sense as a response to a specific set of shortcomings. Treat this section as an inference, not a verbatim quotation.)*

The product spec's five readiness distinctions (below) imply a critique of how exam preparation is conventionally measured: coaching businesses and most ed-tech products conflate "did the student see this material" with "can the student apply it," and conflate "volume of questions attempted" with "coverage of the legitimate ways this concept is actually tested." The product spec's explicit differentiators — a real concept graph instead of a syllabus tree, an Examiner Lens that analyzes *what is actually tested* rather than generating from a shortcut, a Question Universe that tracks coverage against a curated taxonomy instead of claiming completeness, and an Autopsy that forms a falsifiable hypothesis instead of asserting a diagnosis — each directly answer a specific failure mode of conventional test-prep content and feedback.

## The five readiness distinctions the product must separately measure

From `docs/PRODUCT_SPEC.md` §3, verbatim table:

| Dimension | What it answers | Not the same as |
|---|---|---|
| Syllabus completion | Has the student seen the material? | Mastery |
| Concept mastery | Can the student apply the concept correctly, observed over attempts? | Confidence (never measured) |
| Question-pattern coverage | Has the student handled the known legitimate ways this concept is tested? | Volume of questions done |
| Advanced readiness | Can the student handle above-exam-difficulty, trap, and novel-presentation versions? | Standard-difficulty accuracy |
| Speed / accuracy / novelty-handling / pressure performance | Four independently tracked, observable performance axes | A single blended "score" |

These are stored as distinct, queryable facts per (student, concept), never folded into one number — this is the direct ancestor of `@ipmat/mastery`'s multidimensional, never-composite design (see [25_MASTERY.md](25_MASTERY.md)).

## The core differentiators, and where each landed in the actual system

| Differentiator (product spec §4) | What it became | Memory file |
|---|---|---|
| Concept Universe — a real graph, 8 typed edges | `@ipmat/concept-graph` | [40_CONCEPT_UNIVERSE.md](40_CONCEPT_UNIVERSE.md) |
| Examiner Lens — structured analysis, not a generation shortcut | `@ipmat/examiner-lens` | [41_EXAMINER_LENS.md](41_EXAMINER_LENS.md) |
| Question Universe — coverage taxonomy, never claimed completeness | `@ipmat/question-engine` (pattern families / taxonomy cells) | [42_QUESTION_UNIVERSE.md](42_QUESTION_UNIVERSE.md) |
| Question DNA — metadata-complete before servable | `Question` schema + `validateQuestionDna()` | [43_QUESTION_DNA.md](43_QUESTION_DNA.md) |
| Question Autopsy — hypothesis, not verdict | `@ipmat/autopsy` (OBSERVATION → EVIDENCE → HYPOTHESIS → CONFIRMED DIAGNOSIS) | [23_AUTOPSY.md](23_AUTOPSY.md) |
| Overtraining (difficulty tiers as exposure levels above expected difficulty) | `DifficultyTier` (standard/advanced/hard/extreme/novel) + validation gates | [43_QUESTION_DNA.md](43_QUESTION_DNA.md) |
| Surprise / Trap / Pressure, Calculation Gym, Vocabulary Gym (named in spec §4.7 as future) | Trap Lab, Pressure Training, Calculation Gym all now built; Vocabulary Gym still unbuilt/unnamed elsewhere | [30_TRAINING_SYSTEMS.md](30_TRAINING_SYSTEMS.md) |
| Calendar-aware preparation, decoupled from mastery | `@ipmat/prep-phase` (`computePrepPhase`, `applyCatchUp`) | [20_STUDENT_MODEL.md](20_STUDENT_MODEL.md) §Prep Phase |

## Primary user (this phase)

A single student persona: an IPMAT Indore aspirant working through Percentages. No parent portal, no coaching-admin console, no multi-tenant org model yet — these are shaped for in the domain model (schema fields exist that would generalize) but not built. See `docs/PRODUCT_SPEC.md` §6.

## How this generalizes beyond Percentages, without building for it yet

Nothing in the domain layer names "Percentages" in a type or table — everything is `concept_id`/`concept_name`-parameterized (`docs/QUESTION_ENGINE.md` §9). Adding the next chapter is: curate its concept graph, optionally add `ConceptDepth`, run the Examiner Lens, author its pattern families, let the taxonomy and generation pipeline fill in — no schema or domain-package redesign is anticipated. This is stated explicitly as the test of whether the current design is right, not an assumption to be taken on faith.
