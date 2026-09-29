import { describe, expect, it } from "vitest";
import type { FetchLike } from "../../src/http.js";
import { apiEnroll, apiGetEnrollment } from "../../src/enrollment/api.js";

const ENROLLMENT_BODY = { id: "enrollment-1", examId: "exam-1", enrolledAt: "2026-09-29T00:00:00.000Z" };
const PREP_PHASE_BODY = {
  examId: "exam-1",
  today: "2026-09-29T00:00:00.000Z",
  enrollmentDate: "2026-09-29T00:00:00.000Z",
  daysToExamToday: 108,
  daysToExamAtEnrollment: 108,
  expectedCoverageToday: { Percentages: 0.25 },
  expectedCoverageAtEnrollment: { Percentages: 0.25 },
  enrolledLate: true
};

function fakeFetch(response: { ok: boolean; status: number; body: unknown }): { calls: Array<{ url: string; init?: RequestInit }>; fetchImpl: FetchLike } {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return { ok: response.ok, status: response.status, json: async () => response.body };
  };
  return { calls, fetchImpl };
}

function throwingFetch(): { fetchImpl: FetchLike } {
  return {
    fetchImpl: async () => {
      throw new TypeError("Failed to fetch");
    }
  };
}

describe("apiGetEnrollment", () => {
  it("makes a GET request with no body, credentials included, to /v1/enrollment", async () => {
    const { calls, fetchImpl } = fakeFetch({ ok: true, status: 200, body: { enrollment: null, prepPhase: null } });
    await apiGetEnrollment(fetchImpl);
    expect(calls[0]?.url).toMatch(/\/v1\/enrollment$/);
    expect(calls[0]?.init?.method).toBe("GET");
    expect(calls[0]?.init?.credentials).toBe("include");
    expect(calls[0]?.init?.body).toBeUndefined();
  });

  it("returns enrollment: null, prepPhase: null for a not-yet-enrolled student", async () => {
    const { fetchImpl } = fakeFetch({ ok: true, status: 200, body: { enrollment: null, prepPhase: null } });
    const result = await apiGetEnrollment(fetchImpl);
    expect(result).toEqual({ ok: true, enrollment: null, prepPhase: null });
  });

  it("returns the enrollment and prepPhase for an enrolled student", async () => {
    const { fetchImpl } = fakeFetch({ ok: true, status: 200, body: { enrollment: ENROLLMENT_BODY, prepPhase: PREP_PHASE_BODY } });
    const result = await apiGetEnrollment(fetchImpl);
    expect(result).toEqual({ ok: true, enrollment: ENROLLMENT_BODY, prepPhase: PREP_PHASE_BODY });
  });

  it("treats a malformed response (enrollment present but prepPhase missing) as unexpected, never half-trusted", async () => {
    const { fetchImpl } = fakeFetch({ ok: true, status: 200, body: { enrollment: ENROLLMENT_BODY, prepPhase: null } });
    const result = await apiGetEnrollment(fetchImpl);
    expect(result).toEqual({ ok: false, failure: { kind: "unexpected", message: "Something went wrong. Please try again." } });
  });

  it("maps a 401 to not_authenticated", async () => {
    const { fetchImpl } = fakeFetch({ ok: false, status: 401, body: { error: { code: "not_authenticated", message: "You are not logged in." } } });
    const result = await apiGetEnrollment(fetchImpl);
    expect(result).toEqual({ ok: false, failure: { kind: "not_authenticated" } });
  });

  it("reports network_error if the request itself fails", async () => {
    const { fetchImpl } = throwingFetch();
    const result = await apiGetEnrollment(fetchImpl);
    expect(result).toEqual({ ok: false, failure: { kind: "network_error" } });
  });
});

describe("apiEnroll", () => {
  it("makes a POST request with no body, credentials included, to /v1/enrollment", async () => {
    const { calls, fetchImpl } = fakeFetch({ ok: true, status: 200, body: { enrollment: ENROLLMENT_BODY, prepPhase: PREP_PHASE_BODY } });
    await apiEnroll(fetchImpl);
    expect(calls[0]?.url).toMatch(/\/v1\/enrollment$/);
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.credentials).toBe("include");
    expect(calls[0]?.init?.body).toBeUndefined();
  });

  it("never sends a studentId or any body at all -- the browser cannot choose which student is enrolled", async () => {
    const { calls, fetchImpl } = fakeFetch({ ok: true, status: 200, body: { enrollment: ENROLLMENT_BODY, prepPhase: PREP_PHASE_BODY } });
    await apiEnroll(fetchImpl);
    expect(calls[0]?.init?.headers).toBeUndefined(); // no content-type header is sent for a bodyless request either
  });

  it("returns the enrollment and prepPhase on success", async () => {
    const { fetchImpl } = fakeFetch({ ok: true, status: 200, body: { enrollment: ENROLLMENT_BODY, prepPhase: PREP_PHASE_BODY } });
    const result = await apiEnroll(fetchImpl);
    expect(result).toEqual({ ok: true, enrollment: ENROLLMENT_BODY, prepPhase: PREP_PHASE_BODY });
  });

  it("maps a 401 to not_authenticated", async () => {
    const { fetchImpl } = fakeFetch({ ok: false, status: 401, body: { error: { code: "not_authenticated", message: "You are not logged in." } } });
    const result = await apiEnroll(fetchImpl);
    expect(result).toEqual({ ok: false, failure: { kind: "not_authenticated" } });
  });

  it("reports network_error if the request itself fails", async () => {
    const { fetchImpl } = throwingFetch();
    const result = await apiEnroll(fetchImpl);
    expect(result).toEqual({ ok: false, failure: { kind: "network_error" } });
  });
});
