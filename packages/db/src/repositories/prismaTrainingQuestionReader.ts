import type { PrismaClient } from "@prisma/client";
import type { DifficultyDimensions, DifficultyTier, ExamRelevance, NoveltyLevel, TestingMode, ValidationState } from "@ipmat/question-engine";
import type { TrainingQuestionReader, TrainingQuestionRecord } from "./types.js";

/**
 * The plain row shape `toTrainingQuestionRecord()` maps — exactly the
 * columns/joins `PrismaTrainingQuestionReader` SELECTs, and deliberately
 * nothing answer-bearing (`correctAnswer`, `options`, `solutionSteps`,
 * `groundTruthDerivation`, `body` are never selected for this read).
 * `difficultyDimensions` is `unknown` because it is a `Json` column — it is
 * validated, never cast.
 */
export interface TrainingQuestionRow {
  id: string;
  validationState: ValidationState;
  difficultyTier: DifficultyTier;
  difficultyDimensions: unknown;
  noveltyLevel: NoveltyLevel;
  examRelevance: ExamRelevance;
  expectedTimeSeconds: number;
  testingModes: TestingMode[];
  combinesWithConceptIds: string[];
  patternTaxonomyCellId: string;
  trapErrorTaxonomyId: string | null;
  exam: { code: string };
  section: { name: string };
  chapter: { name: string };
  concept: { name: string };
  patternTaxonomyCell: { patternFamily: { name: string } };
  trapErrorTaxonomy: { code: string } | null;
}

const DIFFICULTY_DIMENSION_KEYS = [
  "conceptualLoad",
  "computationalLoad",
  "trapDensity",
  "representationNovelty",
  "timePressure",
  "multiStepDepth"
] as const satisfies ReadonlyArray<keyof DifficultyDimensions>;

/** `null` unless the Json value carries all six dimensions as finite numbers — never a partial or defaulted object. */
export function parseDifficultyDimensions(value: unknown): DifficultyDimensions | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const parsed: Partial<Record<(typeof DIFFICULTY_DIMENSION_KEYS)[number], number>> = {};
  for (const key of DIFFICULTY_DIMENSION_KEYS) {
    const dimension = record[key];
    if (typeof dimension !== "number" || !Number.isFinite(dimension)) return null;
    parsed[key] = dimension;
  }
  return parsed as DifficultyDimensions;
}

/**
 * Pure row -> read-model mapping, shared by the Prisma reader and testable
 * without a database. Returns `null` — the question is EXCLUDED, never
 * coerced — when its DNA does not resolve completely:
 * - not `published` (defense in depth; the query already filters on it),
 * - `expectedTimeSeconds` not a positive integer,
 * - no `testingModes` (Question DNA is enforced, not conventional),
 * - `difficultyDimensions` malformed,
 * - a `trapErrorTaxonomyId` that did not resolve to an `ErrorTaxonomy.code`,
 * - any `combinesWithConceptIds` entry that does not resolve to a real
 *   `Concept.name` (never an invented or partial name list).
 */
export function toTrainingQuestionRecord(row: TrainingQuestionRow, conceptNamesById: ReadonlyMap<string, string>): TrainingQuestionRecord | null {
  if (row.validationState !== "published") return null;
  if (!Number.isInteger(row.expectedTimeSeconds) || row.expectedTimeSeconds <= 0) return null;
  if (row.testingModes.length === 0) return null;

  const difficultyDimensions = parseDifficultyDimensions(row.difficultyDimensions);
  if (!difficultyDimensions) return null;

  if (row.trapErrorTaxonomyId !== null && row.trapErrorTaxonomy === null) return null;

  const combinesWithConcepts: string[] = [];
  for (const conceptId of row.combinesWithConceptIds) {
    const name = conceptNamesById.get(conceptId);
    if (name === undefined) return null;
    combinesWithConcepts.push(name);
  }

  return {
    question: {
      questionId: row.id,
      examCode: row.exam.code,
      sectionName: row.section.name,
      chapterName: row.chapter.name,
      conceptName: row.concept.name,
      patternFamilyName: row.patternTaxonomyCell.patternFamily.name,
      patternTaxonomyCellId: row.patternTaxonomyCellId,
      difficultyTier: row.difficultyTier,
      difficultyDimensions,
      noveltyLevel: row.noveltyLevel,
      examRelevance: row.examRelevance,
      testingModes: [...row.testingModes],
      trapErrorTaxonomyCode: row.trapErrorTaxonomy?.code ?? null,
      combinesWithConcepts
    },
    expectedTimeSeconds: row.expectedTimeSeconds,
    validationState: row.validationState
  };
}

/**
 * The ONE concrete, database-backed implementation of
 * `TrainingQuestionReader` (docs/project-memory/37_TRAINING_RECOMMENDATION.md
 * §6, §8). Read-only. Uses `select` (never `include`) on `Question` so the
 * answer key and solution columns are not even loaded into memory for this
 * read (docs/DECISIONS.md D-020). Exactly two queries: the published
 * questions with their joins, then one batched `Concept` lookup resolving
 * every `combinesWithConceptIds` entry by id.
 */
export class PrismaTrainingQuestionReader implements TrainingQuestionReader {
  constructor(private readonly prisma: PrismaClient) {}

  async findPublishedByExamId(examId: string): Promise<TrainingQuestionRecord[]> {
    const rows: TrainingQuestionRow[] = await this.prisma.question.findMany({
      where: { examId, validationState: "published" },
      orderBy: { id: "asc" },
      select: {
        id: true,
        validationState: true,
        difficultyTier: true,
        difficultyDimensions: true,
        noveltyLevel: true,
        examRelevance: true,
        expectedTimeSeconds: true,
        testingModes: true,
        combinesWithConceptIds: true,
        patternTaxonomyCellId: true,
        trapErrorTaxonomyId: true,
        exam: { select: { code: true } },
        section: { select: { name: true } },
        chapter: { select: { name: true } },
        concept: { select: { name: true } },
        patternTaxonomyCell: { select: { patternFamily: { select: { name: true } } } },
        trapErrorTaxonomy: { select: { code: true } }
      }
    });

    const combinedConceptIds = [...new Set(rows.flatMap((row) => row.combinesWithConceptIds))];
    const combinedConcepts =
      combinedConceptIds.length > 0
        ? await this.prisma.concept.findMany({ where: { id: { in: combinedConceptIds } }, select: { id: true, name: true } })
        : [];
    const conceptNamesById = new Map(combinedConcepts.map((concept) => [concept.id, concept.name]));

    return rows.map((row) => toTrainingQuestionRecord(row, conceptNamesById)).filter((record): record is TrainingQuestionRecord => record !== null);
  }
}
