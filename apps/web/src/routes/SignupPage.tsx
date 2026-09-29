import { useState, type FormEvent } from "react";
import { useAuth } from "../auth/AuthContext.js";
import { Button, Card, FormField, Screen } from "../design/index.js";
import { Link, useNavigate } from "../router/router.js";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;

interface FieldErrors {
  email?: string;
  password?: string;
  confirmPassword?: string;
}

/**
 * A quick, purely helpful pre-check to save a round trip on the most
 * obvious mistakes — it never decides what's ultimately valid. The
 * server's own response is what actually gates success (see
 * AuthContext.signup()); this function does not import or duplicate
 * `@ipmat/auth`'s real validators (which apps/web must never import at
 * all — see the Web Architecture Lock).
 */
function validate(email: string, password: string, confirmPassword: string): FieldErrors {
  const errors: FieldErrors = {};
  if (!EMAIL_PATTERN.test(email)) errors.email = "Enter a valid email address.";
  if (password.length < MIN_PASSWORD_LENGTH) errors.password = `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (password !== confirmPassword) errors.confirmPassword = "Passwords don't match.";
  return errors;
}

export function SignupPage() {
  const { signup } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;
    setFormError(null);

    const errors = validate(email, password, confirmPassword);
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setSubmitting(true);
    try {
      const result = await signup({ email, password });
      if (result.ok) {
        navigate("/dashboard");
        return;
      }
      const failure = result.failure;
      if (failure.kind === "email_already_registered") {
        setFieldErrors((prev) => ({ ...prev, email: failure.message }));
      } else if (failure.kind === "validation") {
        setFormError(failure.message);
      } else if (failure.kind === "network_error") {
        setFormError("We couldn't reach the server. Check your connection and try again.");
      } else {
        setFormError("Something went wrong. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Screen eyebrow="Sign up" headline="Create your account.">
      <Card>
        <form onSubmit={handleSubmit} noValidate>
          {formError && (
            <p className="form-alert" role="alert">
              {formError}
            </p>
          )}
          <FormField label="Email" htmlFor="signup-email" error={fieldErrors.email}>
            <input
              id="signup-email"
              className="form-input"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </FormField>
          <FormField label="Password" htmlFor="signup-password" error={fieldErrors.password}>
            <input
              id="signup-password"
              className="form-input"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </FormField>
          <FormField label="Confirm password" htmlFor="signup-confirm-password" error={fieldErrors.confirmPassword}>
            <input
              id="signup-confirm-password"
              className="form-input"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              required
            />
          </FormField>
          <Button type="submit" block disabled={submitting}>
            {submitting ? "Creating account…" : "Create account"}
          </Button>
        </form>
      </Card>
      <p className="subtext form-footer-note">
        Already have an account? <Link to="/login">Log in</Link>
      </p>
    </Screen>
  );
}
