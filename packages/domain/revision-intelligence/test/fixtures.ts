import { buildMasteryEvidenceView, type MasteryEvidenceView } from "@ipmat/mastery";
import { runTrainingSystem } from "@ipmat/training-session";
import type { AutopsyQuestionContext, MasteryAttemptRecord, TrainingCandidateQuestion, TrainingSystemContext, TrainingSystemOutcome } from "@ipmat/training-systems";
import { REVISION_INTELLIGENCE_SYSTEM_IDS, type ProviderRun } from "../src/index.js";

export const STUDENT = "student-1";
export const EXAM = "IPMAT_INDORE";
export const NOW = "2026-10-03T12:00:00.000Z";
const MS_PER_DAY = 86_400_000;

/** An ISO timestamp `days` before NOW. */
export const daysAgo = (days: number): string => new Date(Date.parse(NOW) - days * MS_PER_DAY).toISOString();

let counter = 0;
export function resetCounter(): void {
  counter = 0;
}

export function question(id: string, over: Partial<AutopsyQuestionContext> = {}): AutopsyQuestionContext {
  return {
    questionId: id,
    examCode: EXAM,
    sectionName: "Quant",
    chapterName: "Percentages",
    conceptName: "Percentages",
    patternFamilyName: "Reverse Percentage",
    patternTaxonomyCellId: `cell-${id}`,
    difficultyTier: "standard",
    difficultyDimensions: { conceptualLoad: 0.2, computationalLoad: 0.2, trapDensity: 0.15, representationNovelty: 0.05, timePressure: 0.1, multiStepDepth: 0.1 },
    noveltyLevel: "standard",
    examRelevance: "core",
    testingModes: ["direct"],
    trapErrorTaxonomyCode: null,
    combinesWithConcepts: [],
    ...over
  };
}

export function attempt(q: AutopsyQuestionContext, over: { id?: string; studentId?: string; status?: "submitted" | "skipped" | "abandoned"; isCorrect?: boolean | null; daysAgo?: number; hints?: number } = {}): MasteryAttemptRecord {
  counter += 1;
  const status = over.status ?? "submitted";
  return {
    contribution: {
      attemptId: over.id ?? `att-${String(counter).padStart(4, "0")}`,
      studentId: over.studentId ?? STUDENT,
      conceptId: `concept-${q.conceptName}`,
      questionId: q.questionId,
      status,
      isCorrect: status === "submitted" ? (over.isCorrect === undefined ? true : over.isCorrect) : null,
      timeTakenSeconds: 60,
      expectedTimeSeconds: 90,
      hintsUsed: over.hints ?? 0,
      skipped: status === "skipped",
      finalizedAt: daysAgo(over.daysAgo ?? 20)
    },
    question: q
  };
}

export const candidate = (q: AutopsyQuestionContext, over: Partial<TrainingCandidateQuestion> = {}): TrainingCandidateQuestion => ({ question: q, expectedTimeSeconds: 90, validationState: "published", ...over });

export function contextOf(records: MasteryAttemptRecord[], candidates: TrainingCandidateQuestion[], over: Partial<TrainingSystemContext> = {}): TrainingSystemContext {
  return { studentId: STUDENT, masteryByConcept: [], attemptRecords: records, candidates, now: NOW, ...over };
}

export function evidenceOf(records: MasteryAttemptRecord[], conceptNames?: string[]): MasteryEvidenceView {
  return buildMasteryEvidenceView(records, { studentId: STUDENT, examCode: EXAM, conceptNames });
}

/** Runs the REAL providers of the requested systems through the product's own catalog-aware entry point. */
export function realRuns(context: TrainingSystemContext, systemIds: readonly string[] = REVISION_INTELLIGENCE_SYSTEM_IDS): ProviderRun[] {
  return systemIds.map((systemId) => {
    const ran = runTrainingSystem(systemId, context);
    return { systemId, outcome: ran.status === "ran" ? ran.outcome : null };
  });
}

export const selectedOutcome = (q: AutopsyQuestionContext, requirement: Record<string, unknown> = {}, explanation = "scripted provider outcome"): TrainingSystemOutcome => ({
  status: "selected",
  question: q,
  requirement,
  explanation,
  diagnostics: { providerId: "scripted", studentId: STUDENT, eligible: true, candidatesConsidered: 1, excludedMalformedCount: 0, excludedIneligibleCount: 0, notes: [] }
});

/** A small, realistic history: Percentages graded 20 days ago (dormant), including a recurring trap. */
export function dormantWorld(): { records: MasteryAttemptRecord[]; candidates: TrainingCandidateQuestion[] } {
  const q1 = question("q-1", { trapErrorTaxonomyCode: "base_confusion" });
  const q2 = question("q-2", { trapErrorTaxonomyCode: "base_confusion", patternFamilyName: "Successive Percentage Change", testingModes: ["combined"] });
  const q3 = question("q-3");
  const fresh = question("q-fresh", { patternFamilyName: "Reverse Percentage" });
  const trap = question("q-trap", { trapErrorTaxonomyCode: "base_confusion", patternTaxonomyCellId: "cell-trap" });
  const novel = question("q-novel", { noveltyLevel: "novel_representation", testingModes: ["represented_differently"] });
  return {
    records: [attempt(q1, { isCorrect: false, daysAgo: 22 }), attempt(q2, { isCorrect: false, daysAgo: 21 }), attempt(q3, { isCorrect: true, daysAgo: 20 })],
    candidates: [candidate(q1), candidate(q2), candidate(q3), candidate(fresh), candidate(trap), candidate(novel)]
  };
}
