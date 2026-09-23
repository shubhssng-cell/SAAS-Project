import type { ErrorTaxonomyEntry, MasteryAttemptRecord } from "@ipmat/training-systems";
import type { TrapAssociatedFailureRecurrence } from "./types.js";

interface TrapCodeBucket {
  failingQuestionIds: Set<string>;
  conceptNames: Set<string>;
  cellIds: Set<string>;
  familyNames: Set<string>;
  resistanceQuestionIds: Set<string>;
  hintAssistedResistanceQuestionIds: Set<string>;
}

function newBucket(): TrapCodeBucket {
  return { failingQuestionIds: new Set(), conceptNames: new Set(), cellIds: new Set(), familyNames: new Set(), resistanceQuestionIds: new Set(), hintAssistedResistanceQuestionIds: new Set() };
}

function buildDiagnosticNotes(code: string, bucket: TrapCodeBucket, errorTaxonomy: ErrorTaxonomyEntry[] | undefined): string[] {
  const notes: string[] = [];

  // Optional enrichment (docs/DECISIONS.md D-056): MUST NEVER affect recurrence semantics, only
  // the legibility of these notes. Omitted entirely -> no enrichment note at all. Supplied (even
  // empty or missing this code) -> either a resolved label/category note or an explicit
  // "enrichment missing" note; the raw code always remains the authoritative grouping key.
  if (errorTaxonomy !== undefined) {
    const entry = errorTaxonomy.find((e) => e.code === code);
    if (entry) {
      notes.push(`Question-designed trap "${code}" (${entry.category}): ${entry.label}.`);
    } else {
      notes.push(`taxonomy_enrichment_missing:${code}`);
    }
  }

  if (bucket.resistanceQuestionIds.size > 0 || bucket.hintAssistedResistanceQuestionIds.size > 0) {
    notes.push(
      `${bucket.resistanceQuestionIds.size} hint-free and ${bucket.hintAssistedResistanceQuestionIds.size} hint-assisted correct attempt(s) against this trap-tagged code were also observed; this may indicate developing resistance but does not reduce or cancel the recurrence evidence.`
    );
  }

  return notes;
}

/**
 * Derives CANDIDATE-LEVEL "trap-associated failure recurrence" evidence
 * for every error-taxonomy code observed in this student's graded attempt
 * history, aggregated ACROSS ALL CONCEPTS (docs/DECISIONS.md D-056 --
 * concept is contextual metadata, never part of a trap code's identity).
 * Grouping is ONLY by the exact `trapErrorTaxonomyCode` string; codes are
 * never combined merely because they share an `ErrorCategory`. Returns
 * one entry per code that has at least one eligible attempt (failing OR
 * resisted) -- the recurrence THRESHOLD is applied by `applicability.ts`,
 * not here, keeping this function a pure "describe what's observed" step.
 */
export function computeTrapAssociatedFailureRecurrence(
  studentId: string,
  attemptRecords: MasteryAttemptRecord[],
  errorTaxonomy: ErrorTaxonomyEntry[] | undefined
): TrapAssociatedFailureRecurrence[] {
  const byCode = new Map<string, TrapCodeBucket>();

  for (const record of attemptRecords) {
    const contribution = record.contribution;
    if (contribution.studentId !== studentId) continue;
    if (contribution.status !== "submitted" || contribution.isCorrect === null) continue;

    const code = record.question.trapErrorTaxonomyCode;
    if (code === null) continue;

    const bucket = byCode.get(code) ?? newBucket();
    byCode.set(code, bucket);

    if (contribution.isCorrect === false) {
      bucket.failingQuestionIds.add(contribution.questionId);
      bucket.conceptNames.add(record.question.conceptName);
      bucket.cellIds.add(record.question.patternTaxonomyCellId);
      bucket.familyNames.add(record.question.patternFamilyName);
    } else if (contribution.hintsUsed > 0) {
      bucket.hintAssistedResistanceQuestionIds.add(contribution.questionId);
    } else {
      bucket.resistanceQuestionIds.add(contribution.questionId);
    }
  }

  const results: TrapAssociatedFailureRecurrence[] = [];
  for (const [code, bucket] of byCode) {
    results.push({
      errorTaxonomyCode: code,
      distinctFailingQuestionIds: [...bucket.failingQuestionIds].sort(),
      distinctConceptNames: [...bucket.conceptNames].sort(),
      distinctPatternTaxonomyCellIds: [...bucket.cellIds].sort(),
      distinctPatternFamilyNames: [...bucket.familyNames].sort(),
      resistanceQuestionIds: [...bucket.resistanceQuestionIds].sort(),
      hintAssistedResistanceQuestionIds: [...bucket.hintAssistedResistanceQuestionIds].sort(),
      diagnosticNotes: buildDiagnosticNotes(code, bucket, errorTaxonomy)
    });
  }

  return results.sort((a, b) => a.errorTaxonomyCode.localeCompare(b.errorTaxonomyCode));
}
