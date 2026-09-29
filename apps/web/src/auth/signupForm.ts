const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;

export interface SignupFieldErrors {
  email?: string;
  password?: string;
  confirmPassword?: string;
}

export const SIGNUP_FIELD_IDS = {
  email: "signup-email",
  password: "signup-password",
  confirmPassword: "signup-confirm-password"
} as const;

/**
 * A quick, purely helpful pre-check to save a round trip on the most
 * obvious mistakes — it never decides what's ultimately valid. The
 * server's own response is what actually gates success (see
 * AuthContext.signup()); this function does not import or duplicate
 * `@ipmat/auth`'s real validators (which apps/web must never import at
 * all — see the Web Architecture Lock).
 */
export function validateSignup(email: string, password: string, confirmPassword: string): SignupFieldErrors {
  const errors: SignupFieldErrors = {};
  if (!EMAIL_PATTERN.test(email)) errors.email = "Enter a valid email address.";
  if (password.length < MIN_PASSWORD_LENGTH) errors.password = `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (password !== confirmPassword) errors.confirmPassword = "Passwords don't match.";
  return errors;
}

/** The DOM id of the first field (in visual order) that has an error -- so a failed submit can move keyboard/screen-reader focus to the problem instead of leaving it on the Submit button. `null` when there is no error. */
export function firstInvalidFieldId(errors: SignupFieldErrors): string | null {
  if (errors.email) return SIGNUP_FIELD_IDS.email;
  if (errors.password) return SIGNUP_FIELD_IDS.password;
  if (errors.confirmPassword) return SIGNUP_FIELD_IDS.confirmPassword;
  return null;
}
