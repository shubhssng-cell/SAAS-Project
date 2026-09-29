import { describe, expect, it } from "vitest";
import { AuthApiError } from "../src/types.js";
import { t, World } from "./fixtures.js";

describe("AuthApiService.signup", () => {
  it("creates a new account and returns an authenticated session immediately", async () => {
    const service = new World().service();
    const result = await service.signup({ email: "student@example.com", password: "correct-horse" }, { now: t(0) });
    expect(result.student.email).toBe("student@example.com");
    expect(result.student.id).toBeTruthy();
    expect(result.sessionToken).toMatch(/^[0-9a-f]{64}$/);
    expect(result.expiresAt).toBeTruthy();
  });

  it("normalizes email casing/whitespace", async () => {
    const service = new World().service();
    const result = await service.signup({ email: "  Student@Example.COM  ", password: "correct-horse" }, { now: t(0) });
    expect(result.student.email).toBe("student@example.com");
  });

  it("rejects a duplicate email with email_already_registered", async () => {
    const service = new World().service();
    await service.signup({ email: "student@example.com", password: "correct-horse" }, { now: t(0) });
    await expect(service.signup({ email: "student@example.com", password: "another-password" }, { now: t(1) })).rejects.toMatchObject({ code: "email_already_registered" });
  });

  it("rejects a malformed email with invalid_request", async () => {
    const service = new World().service();
    await expect(service.signup({ email: "not-an-email", password: "correct-horse" }, { now: t(0) })).rejects.toMatchObject({ code: "invalid_request" });
  });

  it("rejects a too-short password with invalid_request", async () => {
    const service = new World().service();
    await expect(service.signup({ email: "student@example.com", password: "short" }, { now: t(0) })).rejects.toMatchObject({ code: "invalid_request" });
  });

  it("never returns a passwordHash field anywhere in the result", async () => {
    const service = new World().service();
    const result = await service.signup({ email: "student@example.com", password: "correct-horse" }, { now: t(0) });
    expect(result.student).not.toHaveProperty("passwordHash");
    expect(JSON.stringify(result)).not.toContain("passwordHash");
  });
});

describe("AuthApiService.login", () => {
  it("succeeds with the correct password and returns a new session", async () => {
    const world = new World();
    const service = world.service();
    await service.signup({ email: "student@example.com", password: "correct-horse" }, { now: t(0) });

    const result = await service.login({ email: "student@example.com", password: "correct-horse" }, { now: t(10) });
    expect(result.student.email).toBe("student@example.com");
    expect(result.sessionToken).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rejects an unknown email with invalid_credentials", async () => {
    const service = new World().service();
    await expect(service.login({ email: "nobody@example.com", password: "anything" }, { now: t(0) })).rejects.toMatchObject({ code: "invalid_credentials" });
  });

  it("rejects a wrong password with invalid_credentials", async () => {
    const world = new World();
    const service = world.service();
    await service.signup({ email: "student@example.com", password: "correct-horse" }, { now: t(0) });
    await expect(service.login({ email: "student@example.com", password: "wrong-password" }, { now: t(10) })).rejects.toMatchObject({ code: "invalid_credentials" });
  });

  it("gives the EXACT SAME error for an unknown email and a wrong password (account-enumeration resistance)", async () => {
    const world = new World();
    const service = world.service();
    await service.signup({ email: "student@example.com", password: "correct-horse" }, { now: t(0) });

    let unknownEmailError: AuthApiError | undefined;
    let wrongPasswordError: AuthApiError | undefined;
    try {
      await service.login({ email: "nobody@example.com", password: "anything" }, { now: t(10) });
    } catch (error) {
      unknownEmailError = error as AuthApiError;
    }
    try {
      await service.login({ email: "student@example.com", password: "wrong-password" }, { now: t(10) });
    } catch (error) {
      wrongPasswordError = error as AuthApiError;
    }

    expect(unknownEmailError?.code).toBe(wrongPasswordError?.code);
    expect(unknownEmailError?.message).toBe(wrongPasswordError?.message);
    expect(unknownEmailError?.httpStatus).toBe(wrongPasswordError?.httpStatus);
  });

  it("logging in twice for the same student creates two independent, both-valid sessions", async () => {
    const world = new World();
    const service = world.service();
    await service.signup({ email: "student@example.com", password: "correct-horse" }, { now: t(0) });

    const first = await service.login({ email: "student@example.com", password: "correct-horse" }, { now: t(10) });
    const second = await service.login({ email: "student@example.com", password: "correct-horse" }, { now: t(20) });
    expect(first.sessionToken).not.toBe(second.sessionToken);

    await expect(service.getCurrentSession({ sessionToken: first.sessionToken }, { now: t(30) })).resolves.toBeTruthy();
    await expect(service.getCurrentSession({ sessionToken: second.sessionToken }, { now: t(30) })).resolves.toBeTruthy();
  });
});

describe("AuthApiService.getCurrentSession", () => {
  it("resolves the authenticated student for a valid session token", async () => {
    const world = new World();
    const service = world.service();
    const { sessionToken, student } = await service.signup({ email: "student@example.com", password: "correct-horse" }, { now: t(0) });

    const result = await service.getCurrentSession({ sessionToken }, { now: t(10) });
    expect(result.student).toEqual(student);
  });

  it("rejects a garbage/unknown token with not_authenticated", async () => {
    const service = new World().service();
    await expect(service.getCurrentSession({ sessionToken: "not-a-real-token" }, { now: t(0) })).rejects.toMatchObject({ code: "not_authenticated" });
  });

  it("rejects an expired session with not_authenticated", async () => {
    const world = new World();
    const service = world.service();
    const { sessionToken } = await service.signup({ email: "student@example.com", password: "correct-horse" }, { now: t(0) });

    const FAR_IN_THE_FUTURE = t(60 * 60 * 24 * 15); // past the 14-day TTL
    await expect(service.getCurrentSession({ sessionToken }, { now: FAR_IN_THE_FUTURE })).rejects.toMatchObject({ code: "not_authenticated" });
  });

  it("rejects a logged-out session with not_authenticated", async () => {
    const world = new World();
    const service = world.service();
    const { sessionToken } = await service.signup({ email: "student@example.com", password: "correct-horse" }, { now: t(0) });

    await service.logout({ sessionToken }, { now: t(10) });
    await expect(service.getCurrentSession({ sessionToken }, { now: t(20) })).rejects.toMatchObject({ code: "not_authenticated" });
  });
});

describe("AuthApiService.logout", () => {
  it("invalidates the session -- a subsequent getCurrentSession fails", async () => {
    const world = new World();
    const service = world.service();
    const { sessionToken } = await service.signup({ email: "student@example.com", password: "correct-horse" }, { now: t(0) });

    await service.logout({ sessionToken }, { now: t(10) });
    await expect(service.getCurrentSession({ sessionToken }, { now: t(20) })).rejects.toThrow();
  });

  it("logging out an already-invalid token is a no-op success, never throws", async () => {
    const service = new World().service();
    await expect(service.logout({ sessionToken: "never-issued-token" }, { now: t(0) })).resolves.toBeUndefined();
  });

  it("logging out twice with the same token is a no-op success the second time", async () => {
    const world = new World();
    const service = world.service();
    const { sessionToken } = await service.signup({ email: "student@example.com", password: "correct-horse" }, { now: t(0) });

    await service.logout({ sessionToken }, { now: t(10) });
    await expect(service.logout({ sessionToken }, { now: t(20) })).resolves.toBeUndefined();
  });

  it("logging out one session does not invalidate a different session for the same student", async () => {
    const world = new World();
    const service = world.service();
    await service.signup({ email: "student@example.com", password: "correct-horse" }, { now: t(0) });
    const first = await service.login({ email: "student@example.com", password: "correct-horse" }, { now: t(10) });
    const second = await service.login({ email: "student@example.com", password: "correct-horse" }, { now: t(20) });

    await service.logout({ sessionToken: first.sessionToken }, { now: t(30) });
    await expect(service.getCurrentSession({ sessionToken: first.sessionToken }, { now: t(40) })).rejects.toThrow();
    await expect(service.getCurrentSession({ sessionToken: second.sessionToken }, { now: t(40) })).resolves.toBeTruthy();
  });
});

describe("AuthApiService -- unauthorized/malformed request handling", () => {
  it("rejects an empty email/password with invalid_request before touching any repository", async () => {
    const service = new World().service();
    await expect(service.signup({ email: "", password: "correct-horse" }, { now: t(0) })).rejects.toMatchObject({ code: "invalid_request" });
    await expect(service.login({ email: "student@example.com", password: "" }, { now: t(0) })).rejects.toMatchObject({ code: "invalid_request" });
    await expect(service.getCurrentSession({ sessionToken: "" }, { now: t(0) })).rejects.toMatchObject({ code: "invalid_request" });
    await expect(service.logout({ sessionToken: "" }, { now: t(0) })).rejects.toMatchObject({ code: "invalid_request" });
  });
});
