import { Screen } from "../design/index.js";
import { Link } from "../router/router.js";

/**
 * Placeholder only -- real authentication is Product Phase 1 Units 4-5
 * (see PHASE_1_PLATFORM_SHELL.md). "Continue" is a plain navigation stub,
 * not a login submission: it creates no session, no identity, no token.
 */
export function LoginPage() {
  return (
    <Screen
      eyebrow="Log in"
      headline="Sign-in is coming in a later unit."
      subtext="This screen is a placeholder for the real authentication flow (Product Phase 1, Units 4-5). Nothing you do here creates an account."
    >
      <div className="btn-row">
        <Link to="/onboarding" className="btn btn-primary">
          Continue
        </Link>
        <Link to="/" className="btn btn-secondary">
          Back to landing
        </Link>
      </div>
    </Screen>
  );
}
