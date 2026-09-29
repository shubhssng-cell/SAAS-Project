import { jsonRequest, type FetchLike } from "../http.js";
import type { AuthFailure } from "../auth/failureMapping.js";
import type { EnrollmentDto, PrepPhaseDto } from "./enrollmentState.js";

/**
 * The ONLY place `apps/web` talks to the `/v1/enrollment` HTTP boundary
 * (`@ipmat/enrollment-api` over `apps/api` -- Product Phase 1 Unit 7).
 * Uses the two existing endpoints exactly. The browser never chooses
 * which student is being enrolled -- no `studentId` is ever sent; the
 * server derives it from the same session cookie every other authenticated
 * call already relies on.
 */
export type EnrollmentStatusResult = { ok: true; enrollment: EnrollmentDto | null; prepPhase: PrepPhaseDto | null } | { ok: false; failure: AuthFailure };
export type EnrollResult = { ok: true; enrollment: EnrollmentDto; prepPhase: PrepPhaseDto } | { ok: false; failure: AuthFailure };

function readEnrollment(value: unknown): EnrollmentDto | null {
  if (value === null) return null;
  if (typeof value !== "object") return null;
  const { id, examId, enrolledAt } = value as Record<string, unknown>;
  if (typeof id !== "string" || typeof examId !== "string" || typeof enrolledAt !== "string") return null;
  return { id, examId, enrolledAt };
}

function readPrepPhase(value: unknown): PrepPhaseDto | null {
  if (value === null) return null;
  if (typeof value !== "object") return null;
  const { examId, today, enrollmentDate, daysToExamToday, daysToExamAtEnrollment, expectedCoverageToday, expectedCoverageAtEnrollment, enrolledLate } = value as Record<string, unknown>;
  if (typeof examId !== "string" || typeof today !== "string" || typeof enrollmentDate !== "string") return null;
  if (typeof daysToExamToday !== "number" || typeof daysToExamAtEnrollment !== "number" || typeof enrolledLate !== "boolean") return null;
  if (typeof expectedCoverageToday !== "object" || expectedCoverageToday === null) return null;
  if (typeof expectedCoverageAtEnrollment !== "object" || expectedCoverageAtEnrollment === null) return null;
  return {
    examId,
    today,
    enrollmentDate,
    daysToExamToday,
    daysToExamAtEnrollment,
    expectedCoverageToday: expectedCoverageToday as Record<string, number>,
    expectedCoverageAtEnrollment: expectedCoverageAtEnrollment as Record<string, number>,
    enrolledLate
  };
}

export async function apiGetEnrollment(fetchImpl: FetchLike = fetch): Promise<EnrollmentStatusResult> {
  const result = await jsonRequest(fetchImpl, "GET", "/v1/enrollment");
  if (!result.ok) return result;
  const body = result.body as { enrollment?: unknown; prepPhase?: unknown } | null;
  const enrollment = readEnrollment(body?.enrollment ?? null);
  const prepPhase = readPrepPhase(body?.prepPhase ?? null);
  // Both null or both present -- anything else is a malformed response, never half-trusted.
  if ((enrollment === null) !== (prepPhase === null)) {
    return { ok: false, failure: { kind: "unexpected", message: "Something went wrong. Please try again." } };
  }
  return { ok: true, enrollment, prepPhase };
}

export async function apiEnroll(fetchImpl: FetchLike = fetch): Promise<EnrollResult> {
  const result = await jsonRequest(fetchImpl, "POST", "/v1/enrollment");
  if (!result.ok) return result;
  const body = result.body as { enrollment?: unknown; prepPhase?: unknown } | null;
  const enrollment = readEnrollment(body?.enrollment ?? null);
  const prepPhase = readPrepPhase(body?.prepPhase ?? null);
  if (!enrollment || !prepPhase) {
    return { ok: false, failure: { kind: "unexpected", message: "Something went wrong. Please try again." } };
  }
  return { ok: true, enrollment, prepPhase };
}
