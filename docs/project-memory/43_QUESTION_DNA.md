# 43 — Question DNA

> Part of the [project memory](00_MASTER_CONTEXT.md). Source: `docs/QUESTION_ENGINE.md` §5, `docs/DATABASE.md` §Question, `docs/DECISIONS.md` D-016, D-021 (read in full).

## The mandatory, normalized metadata set

Every `Question` row: `examId, sectionId, chapterId, conceptId, subconcepts[], prerequisites[], combinesWithConceptIds[], patternTaxonomyCellId, skill, difficultyTier, difficultyDimensions (json), noveltyLevel, examRelevance, expectedTimeSeconds, testingModes[], trapErrorTaxonomyId (FK, nullable), body, options, correctAnswer, solutionSteps, groundTruthDerivation, validationState, provenanceId`.

Fields queried frequently are their own normalized, indexed columns — never buried in JSON: `noveltyLevel` (`standard`/`novel_representation`/`novel_combination`/`novel_context`), `examRelevance` (`core`/`peripheral`/`stretch`), `testingModes[]`, `trapErrorTaxonomyId` (a real FK, not a free-text string — D-012/D-016).

## Enforced structurally, not conventionally

A `Question` cannot be marked `published` while any DNA field is null or `provenanceId` is unset — enforced by a hand-written DB-level `CHECK` constraint (`questions_published_requires_provenance`, migration `0001_init`), independent of any application-level check.

## `validateQuestionDna()`

Checks `conceptName`/`subconcepts`/`prerequisites`/`combinesWithConcepts` all reference real graph concepts, and that `patternFamilyName` names a family that actually exists for that concept.

## Difficulty tiers as exposure levels, not nonsense generators

`standard, advanced, hard, extreme, novel` — a "hard" question must still be valid, syllabus-relevant, unambiguous, and correct; validation gates this explicitly (see [45_CONTENT_VALIDATION.md](45_CONTENT_VALIDATION.md)). A question failing validity/unambiguity checks is rejected regardless of how "interesting" its difficulty is.

## Difficulty dimensions are explicitly provisional (D-021)

`difficultyCalibrationStatus` is always `"provisional"` from `buildBlueprintFromCell()` today — `tierBaselineDimensions()` is a hand-picked linear formula, not a measurement. No attempt was made to invent a more convincing-looking formula to hide this gap; real calibration needs actual student-attempt data and/or expert review, neither of which exists.

## Question Blueprint — a specification, not a question

`buildBlueprintFromCell()` builds one `QuestionBlueprint` deterministically from one `PatternTaxonomyCell` + its pattern family — **no AI involved in producing a blueprint**, only in filling one. Carries concept, pattern family, target skill, difficulty tier/dimensions, expected time, combination concepts, trap, testing modes, a free-text `transformationDescription`, and required answer format. Has no `body`/`options`/`correctAnswer` — those don't exist until generation happens.

See also: [44_CONTENT_GENERATION.md](44_CONTENT_GENERATION.md), [45_CONTENT_VALIDATION.md](45_CONTENT_VALIDATION.md).
