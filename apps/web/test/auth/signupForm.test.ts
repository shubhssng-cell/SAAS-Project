import { describe, expect, it } from "vitest";
import { firstInvalidFieldId, SIGNUP_FIELD_IDS, validateSignup } from "../../src/auth/signupForm.js";

describe("validateSignup", () => {
  it("accepts a plausible email, a long-enough password, and a matching confirmation", () => {
    expect(validateSignup("a@b.co", "longenough", "longenough")).toEqual({});
  });

  it("flags each obviously wrong field independently", () => {
    expect(Object.keys(validateSignup("not-an-email", "short", "different")).sort()).toEqual(["confirmPassword", "email", "password"]);
    expect(validateSignup("a@b.co", "longenough", "other")).toEqual({ confirmPassword: "Passwords don't match." });
  });
});

describe("firstInvalidFieldId (Product Phase 1 Unit 11)", () => {
  it("is null when nothing is invalid", () => {
    expect(firstInvalidFieldId({})).toBeNull();
  });

  it("returns the first invalid field in visual order, so focus lands on the earliest problem", () => {
    expect(firstInvalidFieldId({ email: "x", password: "y", confirmPassword: "z" })).toBe(SIGNUP_FIELD_IDS.email);
    expect(firstInvalidFieldId({ password: "y", confirmPassword: "z" })).toBe(SIGNUP_FIELD_IDS.password);
    expect(firstInvalidFieldId({ confirmPassword: "z" })).toBe(SIGNUP_FIELD_IDS.confirmPassword);
  });
});
