import type { CanonicalQuestion, ConceptRecord, StudentQuestionRecord, TrainingQuestionRecord } from "@ipmat/db";
import { DEV_EXAM_ID } from "../src/devContent.js";

/** Never a plausible number -- a leak of any answer key into a response body is unmistakable. */
export const ANSWER_KEY = "ANSWER-KEY-7731";
const CONCEPT_ID = "training-test-concept";

type NoveltyLevel = "standard" | "novel_representation" | "novel_context" | "novel_combination";

export interface TrainingTestSeed {
  questions: CanonicalQuestion[];
  questionContent: StudentQuestionRecord[];
  trainingQuestions: Map<string, TrainingQuestionRecord[]>;
  concepts: Map<string, ConceptRecord[]>;
  historyIds: string[];
  novelIds: string[];
}

/**
 * A development-only, in-memory content set shaped so Novelty Training is applicable once a student has answered the 9 history
 * questions (3 each at standard / novel_representation / novel_context): the one underexposed level is novel_combination, which
 * `novelCount` unattempted published questions serve. Test fixture only -- not content, not a claim about any real question.
 */
export function trainingTestSeed(novelCount = 4): TrainingTestSeed {
  const specs: Array<{ id: string; noveltyLevel: NoveltyLevel }> = [];
  const historyIds: string[] = [];
  const novelIds: string[] = [];
  for (const [level, prefix] of [["standard", "h-std"], ["novel_representation", "h-rep"], ["novel_context", "h-ctx"]] as const) {
    for (let i = 1; i <= 3; i += 1) {
      historyIds.push(`${prefix}-${i}`);
      specs.push({ id: `${prefix}-${i}`, noveltyLevel: level });
    }
  }
  for (let i = 1; i <= novelCount; i += 1) {
    novelIds.push(`novel-${i}`);
    specs.push({ id: `novel-${i}`, noveltyLevel: "novel_combination" });
  }

  return {
    historyIds,
    novelIds,
    questions: specs.map((s) => ({ id: s.id, conceptId: CONCEPT_ID, options: null, correctAnswer: ANSWER_KEY, solutionSteps: [], expectedTimeSeconds: 90, validationState: "published" }) as CanonicalQuestion),
    questionContent: specs.map((s) => ({ id: s.id, chapterName: "Percentages", conceptName: "Percentages", prompt: `Prompt for ${s.id}`, answerFormat: "numeric_entry", options: null, expectedTimeSeconds: 90 }) as StudentQuestionRecord),
    trainingQuestions: new Map([
      [
        DEV_EXAM_ID,
        specs.map(
          (s) =>
            ({
              question: {
                questionId: s.id,
                examCode: "IPMAT_INDORE",
                sectionName: "Quant",
                chapterName: "Percentages",
                conceptName: "Percentages",
                patternFamilyName: "Reverse Percentage",
                patternTaxonomyCellId: `cell-${s.id}`,
                difficultyTier: "standard",
                difficultyDimensions: { conceptualLoad: 0.2, computationalLoad: 0.2, trapDensity: 0.15, representationNovelty: 0.05, timePressure: 0.1, multiStepDepth: 0.1 },
                noveltyLevel: s.noveltyLevel,
                examRelevance: "core",
                testingModes: ["direct"],
                trapErrorTaxonomyCode: null,
                combinesWithConcepts: []
              },
              expectedTimeSeconds: 90,
              validationState: "published"
            }) as TrainingQuestionRecord
        )
      ]
    ]),
    concepts: new Map([[DEV_EXAM_ID, [{ id: CONCEPT_ID, name: "Percentages", chapterId: "training-test-chapter" }]]])
  };
}
