import type { EnrollmentState } from "../enrollment/enrollmentState.js";

/**
 * The dashboard's own narrow, student-safe view of the server-derived
 * enrollment/prep-phase state (Product Phase 1 Unit 8) — deliberately NOT
 * a re-export of `EnrollmentState.enrollment`/`.prepPhase` (which carry
 * raw ids and every field `@ipmat/enrollment-api` returns): only the two
 * facts this dashboard actually displays. The frontend never computes
 * `daysToExamToday` itself — it is read directly from the server's own
 * `prepPhase.daysToExamToday`, exactly as `computePrepPhase()` produced it.
 */
export interface PrepStatusViewModel {
  enrolledAt: string;
  daysToExamToday: number;
}

/**
 * Pure derivation, unit-testable without rendering — `DashboardRoute.tsx`
 * calls this and renders accordingly. Returns `null` for any status other
 * than `"enrolled"` (idle/loading/not-enrolled/error) — `DashboardRoute`
 * is only ever reached after `EnrollmentGate(require-complete)` has
 * already resolved to `"enrolled"`, but this function does not assume
 * that silently; a `null` result is a defensive fallback, not a crash.
 */
export function derivePrepStatus(enrollmentState: EnrollmentState): PrepStatusViewModel | null {
  if (enrollmentState.status !== "enrolled") return null;
  return { enrolledAt: enrollmentState.enrollment.enrolledAt, daysToExamToday: enrollmentState.prepPhase.daysToExamToday };
}

/** `"en-IN"` matches this product's audience (Indian competitive exams — see docs/PRODUCT_SPEC.md); a plain, unambiguous long-form date, never a raw ISO timestamp shown to a student. */
export function formatEnrolledDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", { year: "numeric", month: "long", day: "numeric" });
}

/** The one-line greeting under the dashboard headline — just the student's own email, never an internal id. */
export function greetingSubtext(studentEmail: string): string {
  return `${studentEmail} — preparing for IPMAT.`;
}

/**
 * The practice-progress note shown above the "Start Practice" action.
 * Deliberately reports ONLY the observable count the fixture adapter
 * already returns (`questionsPracticedSoFar`) — never a fabricated
 * readiness/ability claim (no "you are X% ready," no confidence score;
 * see docs/DECISIONS.md D-005).
 */
export function practiceProgressNote(questionsPracticedSoFar: number): string {
  if (questionsPracticedSoFar === 0) {
    return "Let's see how you approach a few questions before we personalize anything.";
  }
  return `You've worked through ${questionsPracticedSoFar} question${questionsPracticedSoFar === 1 ? "" : "s"} so far.`;
}
