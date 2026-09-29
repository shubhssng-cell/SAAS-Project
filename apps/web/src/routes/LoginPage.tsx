import { Link } from "../router/router.js";

/**
 * Placeholder only -- real authentication is Product Phase 1 Units 4-5
 * (see PHASE_1_PLATFORM_SHELL.md). "Continue" is a plain navigation stub,
 * not a login submission: it creates no session, no identity, no token.
 */
export function LoginPage() {
  return (
    <div className="screen">
      <p className="eyebrow">Log in</p>
      <h1 className="headline">Sign-in is coming in a later unit.</h1>
      <p className="subtext">This screen is a placeholder for the real authentication flow (Product Phase 1, Units 4-5). Nothing you do here creates an account.</p>
      <div className="btn-row">
        <Link to="/onboarding" className="btn btn-primary">
          Continue
        </Link>
        <Link to="/" className="btn btn-secondary">
          Back to landing
        </Link>
      </div>
    </div>
  );
}
