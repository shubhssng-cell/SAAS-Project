import { describe, expect, it } from "vitest";
import { AuthValidationError, assertValidEmail, assertValidPassword, normalizeEmail } from "../src/validation.js";

describe("normalizeEmail", () => {
  it("trims whitespace and lowercases", () => {
    expect(normalizeEmail("  Student@Example.COM  ")).toBe("student@example.com");
  });
});

describe("assertValidEmail", () => {
  it("accepts a well-formed email", () => {
    expect(() => assertValidEmail("student@example.com")).not.toThrow();
  });

  it.each(["not-an-email", "missing-at.com", "missing-domain@", "@missing-local.com", ""])("rejects malformed input: %s", (value) => {
    expect(() => assertValidEmail(value)).toThrow(AuthValidationError);
  });

  it("throws AuthValidationError with code invalid_email", () => {
    try {
      assertValidEmail("not-an-email");
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(AuthValidationError);
      expect((error as AuthValidationError).code).toBe("invalid_email");
    }
  });
});

describe("assertValidPassword", () => {
  it("accepts a password at or above the minimum length", () => {
    expect(() => assertValidPassword("12345678")).not.toThrow();
    expect(() => assertValidPassword("a-very-long-password")).not.toThrow();
  });

  it("rejects a password below the minimum length", () => {
    expect(() => assertValidPassword("short")).toThrow(AuthValidationError);
  });

  it("throws AuthValidationError with code password_too_short", () => {
    try {
      assertValidPassword("short");
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(AuthValidationError);
      expect((error as AuthValidationError).code).toBe("password_too_short");
    }
  });
});
