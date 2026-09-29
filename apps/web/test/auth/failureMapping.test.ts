import { describe, expect, it } from "vitest";
import { mapAuthApiErrorCode, NETWORK_FAILURE } from "../../src/auth/failureMapping.js";

describe("mapAuthApiErrorCode", () => {
  it("maps invalid_request to validation with the server's own message", () => {
    expect(mapAuthApiErrorCode("invalid_request", "\"email\" must be a non-empty string.")).toEqual({ kind: "validation", message: "\"email\" must be a non-empty string." });
  });

  it("maps invalid_credentials to a generic, hand-authored message -- never the server's raw message", () => {
    const result = mapAuthApiErrorCode("invalid_credentials", "server text that should never surface");
    expect(result).toEqual({ kind: "invalid_credentials", message: "Incorrect email or password." });
  });

  it("maps email_already_registered", () => {
    expect(mapAuthApiErrorCode("email_already_registered", "anything")).toEqual({ kind: "email_already_registered", message: "An account with this email already exists." });
  });

  it("maps not_authenticated to a bare kind with no message field", () => {
    expect(mapAuthApiErrorCode("not_authenticated", "anything")).toEqual({ kind: "not_authenticated" });
  });

  it("maps an unrecognized/missing code to unexpected, never to success or validation", () => {
    expect(mapAuthApiErrorCode(undefined, undefined)).toEqual({ kind: "unexpected", message: "Something went wrong. Please try again." });
    expect(mapAuthApiErrorCode("infrastructure_failure", "raw db error")).toEqual({ kind: "unexpected", message: "Something went wrong. Please try again." });
    expect(mapAuthApiErrorCode("some_future_code_this_file_does_not_know", "x")).toEqual({ kind: "unexpected", message: "Something went wrong. Please try again." });
  });
});

describe("NETWORK_FAILURE", () => {
  it("is the fixed network_error sentinel", () => {
    expect(NETWORK_FAILURE).toEqual({ kind: "network_error" });
  });
});
