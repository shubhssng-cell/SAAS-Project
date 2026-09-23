import type { TrainingSystemDiagnostics } from "./types.js";

/**
 * A plain field-default constructor — NOT a candidate-ranking or
 * filtering utility. Deliberately the ONLY "logic" this package ships
 * beyond types, so the shared contract cannot be mistaken for, or misused
 * as, a place to build selection behavior.
 */
export function buildTrainingSystemDiagnostics(input: {
  providerId: string;
  studentId: string;
  eligible: boolean;
  candidatesConsidered?: number;
  excludedMalformedCount?: number;
  excludedIneligibleCount?: number;
  notes?: string[];
}): TrainingSystemDiagnostics {
  return {
    providerId: input.providerId,
    studentId: input.studentId,
    eligible: input.eligible,
    candidatesConsidered: input.candidatesConsidered ?? 0,
    excludedMalformedCount: input.excludedMalformedCount ?? 0,
    excludedIneligibleCount: input.excludedIneligibleCount ?? 0,
    notes: input.notes ?? []
  };
}
