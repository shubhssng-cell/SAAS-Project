import type { AdaptiveCurriculum } from "@ipmat/adaptive-curriculum";
import type { RevisionIntelligence } from "@ipmat/revision-intelligence";
import { noPreferenceDecision, type PersonalizationDecision } from "./decisions.js";
import type { StudentPreferences } from "./preferences.js";

/**
 * Personalization and adaptation are kept distinct (Phase 8 Unit 4, D-095). ADAPTATION is what existing
 * training evidence calls for (repair, training systems, adaptive practice, revision) and it is already
 * decided by the existing engines. PERSONALIZATION is what an explicit student preference changes. They
 * compose, but neither is allowed to become the other: nothing here reads attempts, ranks anything or
 * infers anything about the student.
 *
 * Today NO preference constrains question selection - none is defined, and `TrainingCandidateQuestion`
 * carries no field a preference could act on - so these functions return the existing result BY
 * REFERENCE, UNCHANGED, together with an explicit report that nothing was altered and why. That report
 * is the point: "no personalization applied" is a stated, tested outcome, not an omission. A future
 * selection preference would add a rule to the catalogue and narrow the candidate pool BEFORE the
 * existing orchestrator runs; it would never replace the orchestrator, and it could never widen the
 * pool beyond published, exam-scoped questions.
 */
export interface PersonalizationReport {
  /** True only if personalization changed the underlying decision or its data. Always false in this unit. */
  altered: boolean;
  selectionAltered: boolean;
  presentationAltered: boolean;
  decisions: PersonalizationDecision[];
}

export interface Personalized<T> {
  /** The existing result, the SAME object, unmodified. */
  value: T;
  personalization: PersonalizationReport;
}

function passThrough<T>(value: T, rule: "CURR-0" | "REV-0", dimension: "curriculum" | "revision", preferences: StudentPreferences): Personalized<T> {
  const what = dimension === "curriculum" ? "curriculum recommendation" : "revision intelligence";
  const decisions: PersonalizationDecision[] = [{ dimension, rule, input: { kind: "none" }, effect: "not_applied", limitedBy: null, output: `no preference constrains ${dimension === "curriculum" ? "question selection" : "revision"}; the ${what} is shown exactly as the existing engine produced it` }];
  // A language or length preference does not touch the DATA of either: it is applied by the tutor when it words an explanation.
  if (preferences.language !== null || preferences.verbosity !== null) {
    decisions.push(noPreferenceDecision(dimension, "language and length preferences apply to the tutor's wording only; the data of this result is unchanged"));
  }
  return { value, personalization: { altered: false, selectionAltered: false, presentationAltered: false, decisions } };
}

export function personalizeCurriculum(curriculum: AdaptiveCurriculum, preferences: StudentPreferences): Personalized<AdaptiveCurriculum> {
  return passThrough(curriculum, "CURR-0", "curriculum", preferences);
}

export function personalizeRevision(revision: RevisionIntelligence, preferences: StudentPreferences): Personalized<RevisionIntelligence> {
  return passThrough(revision, "REV-0", "revision", preferences);
}
