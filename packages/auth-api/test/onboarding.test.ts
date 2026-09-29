import { describe, expect, it } from "vitest";
import { t, World } from "./fixtures.js";

describe("AuthApiService.completeOnboarding", () => {
  it("a newly-signed-up student has onboarding incomplete", async () => {
    const world = new World();
    const service = world.service();
    const { student } = await service.signup({ email: "student@example.com", password: "correct-horse" }, { now: t(0) });
    expect(student.onboardingCompletedAt).toBeNull();
  });

  it("getCurrentSession reflects the same incomplete state before completion", async () => {
    const world = new World();
    const service = world.service();
    const { sessionToken } = await service.signup({ email: "student@example.com", password: "correct-horse" }, { now: t(0) });
    const { student } = await service.getCurrentSession({ sessionToken }, { now: t(10) });
    expect(student.onboardingCompletedAt).toBeNull();
  });

  it("completes onboarding for the session-authenticated student", async () => {
    const world = new World();
    const service = world.service();
    const { sessionToken } = await service.signup({ email: "student@example.com", password: "correct-horse" }, { now: t(0) });

    const result = await service.completeOnboarding({ sessionToken }, { now: t(10) });
    expect(result.student.onboardingCompletedAt).toBe(t(10));
  });

  it("completion persists -- a fresh getCurrentSession call (a new 'request') reflects it", async () => {
    const world = new World();
    const service = world.service();
    const { sessionToken } = await service.signup({ email: "student@example.com", password: "correct-horse" }, { now: t(0) });
    await service.completeOnboarding({ sessionToken }, { now: t(10) });

    const { student } = await service.getCurrentSession({ sessionToken }, { now: t(20) });
    expect(student.onboardingCompletedAt).toBe(t(10));
  });

  it("is idempotent -- calling it twice never moves the completion timestamp and does not throw", async () => {
    const world = new World();
    const service = world.service();
    const { sessionToken } = await service.signup({ email: "student@example.com", password: "correct-horse" }, { now: t(0) });

    const first = await service.completeOnboarding({ sessionToken }, { now: t(10) });
    const second = await service.completeOnboarding({ sessionToken }, { now: t(20) });
    expect(second.student.onboardingCompletedAt).toBe(first.student.onboardingCompletedAt);
    expect(second.student.onboardingCompletedAt).toBe(t(10));
  });

  it("rejects an unauthenticated call (no valid session) with not_authenticated", async () => {
    const service = new World().service();
    await expect(service.completeOnboarding({ sessionToken: "never-issued-token" }, { now: t(0) })).rejects.toMatchObject({ code: "not_authenticated" });
  });

  it("rejects a logged-out session the same as any other invalid token", async () => {
    const world = new World();
    const service = world.service();
    const { sessionToken } = await service.signup({ email: "student@example.com", password: "correct-horse" }, { now: t(0) });
    await service.logout({ sessionToken }, { now: t(10) });

    await expect(service.completeOnboarding({ sessionToken }, { now: t(20) })).rejects.toMatchObject({ code: "not_authenticated" });
  });

  it("the completing student's identity comes ONLY from the session -- there is no parameter to supply a different studentId", async () => {
    // Structural proof: completeOnboarding()'s input type is `{ sessionToken: string }` only.
    // Two different students' sessions each complete ONLY their own onboarding, never each other's.
    const world = new World();
    const service = world.service();
    const a = await service.signup({ email: "student-a@example.com", password: "correct-horse" }, { now: t(0) });
    const b = await service.signup({ email: "student-b@example.com", password: "correct-horse" }, { now: t(1) });

    await service.completeOnboarding({ sessionToken: a.sessionToken }, { now: t(10) });

    const { student: refreshedA } = await service.getCurrentSession({ sessionToken: a.sessionToken }, { now: t(20) });
    const { student: refreshedB } = await service.getCurrentSession({ sessionToken: b.sessionToken }, { now: t(20) });
    expect(refreshedA.onboardingCompletedAt).not.toBeNull();
    expect(refreshedB.onboardingCompletedAt).toBeNull();
  });
});
