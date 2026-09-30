import { useState, type FormEvent } from "react";
import { useAuth } from "../auth/AuthContext.js";
import { useRedirectIfSignedIn } from "../auth/useRedirectIfSignedIn.js";
import { Button, Card, ErrorNotice, FormField, Screen } from "../design/index.js";
import { Link, useNavigate } from "../router/router.js";

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const markSubmitted = useRedirectIfSignedIn();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;
    markSubmitted();
    setFormError(null);
    setSubmitting(true);

    try {
      const result = await login({ email, password });
      if (result.ok) {
        navigate("/dashboard");
        return;
      }
      // Deliberately the SAME message for invalid_credentials regardless of which
      // backend failure occurred (unknown email vs. wrong password) -- the server
      // itself already collapsed these into one code; this page must not
      // reintroduce the distinction (see docs/DECISIONS.md D-004).
      if (result.failure.kind === "invalid_credentials") {
        setFormError(result.failure.message);
      } else if (result.failure.kind === "validation") {
        setFormError(result.failure.message);
      } else if (result.failure.kind === "network_error") {
        setFormError("We couldn't reach the server. Check your connection and try again.");
      } else {
        setFormError("Something went wrong. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Screen eyebrow="Log in" headline="Welcome back.">
      <Card>
        <form onSubmit={handleSubmit} noValidate>
          {formError && <ErrorNotice>{formError}</ErrorNotice>}
          <FormField label="Email" htmlFor="login-email">
            <input
              id="login-email"
              className="form-input"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </FormField>
          <FormField label="Password" htmlFor="login-password">
            <input
              id="login-password"
              className="form-input"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </FormField>
          <Button type="submit" block disabled={submitting}>
            {submitting ? "Logging in…" : "Log in"}
          </Button>
        </form>
      </Card>
      <p className="subtext form-footer-note">
        Don't have an account? <Link to="/signup">Sign up</Link>
      </p>
    </Screen>
  );
}
