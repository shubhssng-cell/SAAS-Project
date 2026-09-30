import { useState, type FormEvent } from "react";
import { useAuth } from "../auth/AuthContext.js";
import { firstInvalidFieldId, SIGNUP_FIELD_IDS, validateSignup, type SignupFieldErrors } from "../auth/signupForm.js";
import { useRedirectIfSignedIn } from "../auth/useRedirectIfSignedIn.js";
import { Button, Card, ErrorNotice, FormField, fieldErrorId, Screen } from "../design/index.js";
import { Link, useNavigate } from "../router/router.js";

/** `aria-invalid` + `aria-describedby` for one signup input, so its validation message is announced with the field. */
function fieldAria(id: string, error: string | undefined) {
  return error ? { "aria-invalid": true as const, "aria-describedby": fieldErrorId(id) } : {};
}

export function SignupPage() {
  const { signup } = useAuth();
  const navigate = useNavigate();
  const markSubmitted = useRedirectIfSignedIn();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<SignupFieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;
    markSubmitted();
    setFormError(null);

    const errors = validateSignup(email, password, confirmPassword);
    setFieldErrors(errors);
    const invalidId = firstInvalidFieldId(errors);
    if (invalidId) {
      document.getElementById(invalidId)?.focus();
      return;
    }

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
        document.getElementById(SIGNUP_FIELD_IDS.email)?.focus();
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
          {formError && <ErrorNotice>{formError}</ErrorNotice>}
          <FormField label="Email" htmlFor={SIGNUP_FIELD_IDS.email} error={fieldErrors.email}>
            <input
              id={SIGNUP_FIELD_IDS.email}
              className="form-input"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              {...fieldAria(SIGNUP_FIELD_IDS.email, fieldErrors.email)}
            />
          </FormField>
          <FormField label="Password" htmlFor={SIGNUP_FIELD_IDS.password} error={fieldErrors.password}>
            <input
              id={SIGNUP_FIELD_IDS.password}
              className="form-input"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              {...fieldAria(SIGNUP_FIELD_IDS.password, fieldErrors.password)}
            />
          </FormField>
          <FormField label="Confirm password" htmlFor={SIGNUP_FIELD_IDS.confirmPassword} error={fieldErrors.confirmPassword}>
            <input
              id={SIGNUP_FIELD_IDS.confirmPassword}
              className="form-input"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              required
              {...fieldAria(SIGNUP_FIELD_IDS.confirmPassword, fieldErrors.confirmPassword)}
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
