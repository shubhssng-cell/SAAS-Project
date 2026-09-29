/**
 * Pure translation from an `AuthApiError`-shaped HTTP response
 * (`{ error: { code, message } }`, exactly what `apps/api/src/server.ts`'s
 * `sendError()` always produces) into a small, closed set of frontend
 * failure kinds. Deliberately does NOT re-decide whether input is valid --
 * the server's `code` is trusted as-is; this function only translates a
 * code the frontend already knows how to render into student-safe copy.
 * An unrecognized code (a genuine server/infrastructure problem, or a
 * future code this file hasn't been taught yet) falls through to
 * `"unexpected"`, never silently treated as success or as validation.
 */
export type AuthFailure =
  | { kind: "validation"; message: string }
  | { kind: "invalid_credentials"; message: string }
  | { kind: "email_already_registered"; message: string }
  | { kind: "not_authenticated" }
  | { kind: "network_error" }
  | { kind: "unexpected"; message: string };

export function mapAuthApiErrorCode(code: string | undefined, message: string | undefined): AuthFailure {
  switch (code) {
    case "invalid_request":
      return { kind: "validation", message: message ?? "Check your input and try again." };
    case "invalid_credentials":
      // Deliberately NEVER distinguishes "no such account" from "wrong password" -- the
      // server itself already collapsed these into one code/message (see
      // docs/DECISIONS.md D-004's account-enumeration note); this function must not
      // reintroduce that distinction on the frontend.
      return { kind: "invalid_credentials", message: "Incorrect email or password." };
    case "email_already_registered":
      return { kind: "email_already_registered", message: "An account with this email already exists." };
    case "not_authenticated":
      return { kind: "not_authenticated" };
    default:
      return { kind: "unexpected", message: "Something went wrong. Please try again." };
  }
}

export const NETWORK_FAILURE: AuthFailure = { kind: "network_error" };
