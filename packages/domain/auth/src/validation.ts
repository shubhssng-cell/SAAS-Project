/** Deliberately simple RFC-5322-adjacent check -- rejects obviously malformed input without trying to be a fully compliant email grammar (this codebase's existing arithmetic/expression validators take the same "narrow, deterministic, good enough" stance -- see D-018/D-029). */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const MIN_PASSWORD_LENGTH = 8;

export type AuthValidationErrorCode = "invalid_email" | "password_too_short";

export class AuthValidationError extends Error {
  readonly code: AuthValidationErrorCode;

  constructor(code: AuthValidationErrorCode, message: string) {
    super(message);
    this.name = "AuthValidationError";
    this.code = code;
  }
}

/** The one canonical form an email is compared/stored in -- case-insensitive, whitespace-trimmed -- so "Student@Example.com" and "student@example.com" are always the same account. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function assertValidEmail(email: string): void {
  if (!EMAIL_PATTERN.test(email)) {
    throw new AuthValidationError("invalid_email", "Enter a valid email address.");
  }
}

export function assertValidPassword(password: string): void {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new AuthValidationError("password_too_short", `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
}
