import { FixtureProvider } from "@ipmat/ai";
import { percentagesConceptGraph } from "@ipmat/concept-graph";
import type { CanonicalQuestion, ConceptRecord, StudentQuestionRecord, TrainingQuestionRecord } from "@ipmat/db";
import { InMemoryQuestionPublicationRepository } from "@ipmat/db";
import {
  assertCandidateIsImportable,
  percentagePointStandaloneStandard,
  percentagesPatternFamilies,
  percentagesReversePercentageExample,
  runGenerationPipeline,
  successivePnlAdvanced,
  validateQuestionDna,
  type CoverageExpansionFixture,
  type QuestionDnaData
} from "@ipmat/question-engine";

/**
 * Product Phase 2 Unit 1 -- DEVELOPMENT-ONLY published practice content for
 * the in-memory `apps/api` wiring. Nothing here is production data, and it
 * does not make the system production-ready: a live database (Prisma
 * readers over real `Question` rows) is still the only real content source
 * for a deployed system.
 *
 * Every question here is original/internal content already living in this
 * repository -- no external, proprietary, or previous-year material -- and
 * none is presented as an official IPMAT question:
 *
 * - The two Phase 3.5 fixture candidates whose difficulty tier (standard /
 *   advanced) permits publication without human review are run through the
 *   REAL `runGenerationPipeline()` (via `FixtureProvider`, never a live
 *   model), must reach `"validated"`, must be importable
 *   (`assertCandidateIsImportable()`), and are then published by the SAME
 *   explicit `decidePublication()` call every publication goes through
 *   (`InMemoryQuestionPublicationRepository.decide()`). The hard/extreme
 *   fixtures are deliberately NOT included: they require human review, which
 *   cannot honestly be claimed here, so they remain unpublished.
 * - The repo's existing original demonstration question (already published
 *   by `packages/db/prisma/seed.ts`, `provenanceSourceType: "original"`),
 *   validated with `validateQuestionDna()`.
 *
 * Question DNA is not weakened or defaulted anywhere below: a question with
 * a missing/invalid field fails to build, it is never coerced.
 */

/** The in-memory wiring's own exam id (`wiring.ts`'s `DEFAULT_EXAM_ID`); training questions are keyed by it so the enrollment's `examId` resolves them. */
export const DEV_EXAM_ID = "exam-ipmat-indore";
const DEV_CHAPTER_ID = "dev-chapter-percentages";
const DEV_CONCEPT_ID = "dev-concept-percentages";

/** The fixture candidates whose difficulty tier (standard/advanced) permits publication without a human reviewer (`requiresHumanReview()` is false for both). */
const PUBLISHABLE_FIXTURES: readonly CoverageExpansionFixture[] = [successivePnlAdvanced, percentagePointStandaloneStandard];

export interface DevContentSeed {
  questions: CanonicalQuestion[];
  questionContent: StudentQuestionRecord[];
  trainingQuestions: Map<string, TrainingQuestionRecord[]>;
  concepts: Map<string, ConceptRecord[]>;
}

/** One question, in the single shape all three read models are derived from -- so they can never disagree with each other. */
interface DevQuestion {
  id: string;
  dna: Omit<QuestionDnaData, "provenanceSourceType" | "validationState" | "skill" | "subconcepts" | "prerequisites">;
  body: string;
  answerFormat: "multiple_choice" | "numeric_entry";
  options: string[] | null;
  correctAnswer: string;
  solutionSteps: string[];
}

function cellId(dna: DevQuestion["dna"]): string {
  return ["dev-cell", dna.patternFamilyName, dna.testingModes.join("+"), dna.trapErrorTaxonomyCode ?? "none", dna.difficultyTier]
    .join(":")
    .toLowerCase()
    .replace(/\s+/g, "-");
}

async function publishedFixtureQuestions(): Promise<DevQuestion[]> {
  const questions: DevQuestion[] = [];
  const stems: string[] = [];
  for (const fixture of PUBLISHABLE_FIXTURES) {
    const provider = new FixtureProvider([JSON.stringify(fixture.candidate), JSON.stringify(fixture.reverification), JSON.stringify(fixture.judge)]);
    const result = await runGenerationPipeline({
      blueprint: fixture.blueprint,
      aiProvider: provider,
      graph: percentagesConceptGraph,
      existingQuestionStems: [...stems],
      provenanceSourceType: "original"
    });
    const { blueprint, candidate } = assertCandidateIsImportable(result); // throws unless the pipeline verdict is "validated"
    const publication = new InMemoryQuestionPublicationRepository([
      { id: blueprint.id, validationState: "ai_validated", difficultyTier: candidate.questionDna.difficultyTier, hasProvenance: true }
    ]);
    const decided = await publication.decide(blueprint.id, "publish"); // the one legitimate publish path; throws if not allowed
    if (decided.validationState !== "published") {
      throw new Error(`Dev content: "${fixture.label}" did not reach "published".`);
    }

    stems.push(candidate.stem);
    questions.push({
      id: `dev-${blueprint.id}`,
      dna: {
        examCode: blueprint.examCode,
        sectionName: blueprint.sectionName,
        chapterName: blueprint.chapterName,
        conceptName: candidate.questionDna.conceptName,
        combinesWithConcepts: candidate.questionDna.combinesWithConcepts,
        patternFamilyName: candidate.questionDna.patternFamilyName,
        difficultyTier: candidate.questionDna.difficultyTier,
        difficultyDimensions: candidate.questionDna.difficultyDimensions,
        noveltyLevel: candidate.questionDna.noveltyLevel,
        examRelevance: candidate.questionDna.examRelevance,
        expectedTimeSeconds: candidate.questionDna.expectedTimeSeconds,
        testingModes: candidate.questionDna.testingModes,
        trapErrorTaxonomyCode: candidate.questionDna.trapErrorTaxonomyCode
      },
      body: candidate.stem,
      answerFormat: candidate.answerFormat,
      options: candidate.options,
      correctAnswer: candidate.correctAnswer,
      solutionSteps: candidate.solutionSteps
    });
  }
  return questions;
}

function demonstrationQuestion(): DevQuestion {
  const { dna, content } = percentagesReversePercentageExample;
  const validation = validateQuestionDna(dna, percentagesConceptGraph, percentagesPatternFamilies);
  if (!validation.valid) {
    throw new Error(`Dev content: the demonstration question's Question DNA is invalid: ${validation.issues.map((i) => i.message).join("; ")}`);
  }
  return {
    id: "dev-q-percentages-reverse-population",
    dna: {
      examCode: dna.examCode,
      sectionName: dna.sectionName,
      chapterName: dna.chapterName,
      conceptName: dna.conceptName,
      combinesWithConcepts: dna.combinesWithConcepts,
      patternFamilyName: dna.patternFamilyName,
      difficultyTier: dna.difficultyTier,
      difficultyDimensions: dna.difficultyDimensions,
      noveltyLevel: dna.noveltyLevel,
      examRelevance: dna.examRelevance,
      expectedTimeSeconds: dna.expectedTimeSeconds,
      testingModes: dna.testingModes,
      trapErrorTaxonomyCode: dna.trapErrorTaxonomyCode
    },
    body: content.body,
    answerFormat: "multiple_choice",
    options: content.options,
    correctAnswer: content.correctAnswer,
    solutionSteps: content.solutionSteps
  };
}

/** Builds the deterministic dev content set. Throws (never partially succeeds) if any question cannot legitimately be published. */
export async function buildDevContentSeed(): Promise<DevContentSeed> {
  const built = [demonstrationQuestion(), ...(await publishedFixtureQuestions())];
  const sorted = [...built].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const trainingRecords: TrainingQuestionRecord[] = sorted.map((q) => ({
    question: {
      questionId: q.id,
      examCode: q.dna.examCode,
      sectionName: q.dna.sectionName,
      chapterName: q.dna.chapterName,
      conceptName: q.dna.conceptName,
      patternFamilyName: q.dna.patternFamilyName,
      patternTaxonomyCellId: cellId(q.dna),
      difficultyTier: q.dna.difficultyTier,
      difficultyDimensions: q.dna.difficultyDimensions,
      noveltyLevel: q.dna.noveltyLevel,
      examRelevance: q.dna.examRelevance,
      testingModes: q.dna.testingModes,
      trapErrorTaxonomyCode: q.dna.trapErrorTaxonomyCode,
      combinesWithConcepts: q.dna.combinesWithConcepts
    },
    expectedTimeSeconds: q.dna.expectedTimeSeconds,
    validationState: "published"
  }));

  return {
    questions: sorted.map((q) => ({
      id: q.id,
      conceptId: DEV_CONCEPT_ID,
      options: q.options,
      correctAnswer: q.correctAnswer,
      solutionSteps: q.solutionSteps,
      expectedTimeSeconds: q.dna.expectedTimeSeconds,
      validationState: "published"
    })),
    questionContent: sorted.map((q) => ({
      id: q.id,
      chapterName: q.dna.chapterName,
      conceptName: q.dna.conceptName,
      prompt: q.body,
      answerFormat: q.answerFormat,
      options: q.options,
      expectedTimeSeconds: q.dna.expectedTimeSeconds
    })),
    trainingQuestions: new Map([[DEV_EXAM_ID, trainingRecords]]),
    concepts: new Map([[DEV_EXAM_ID, [{ id: DEV_CONCEPT_ID, name: "Percentages", chapterId: DEV_CHAPTER_ID }]]])
  };
}
