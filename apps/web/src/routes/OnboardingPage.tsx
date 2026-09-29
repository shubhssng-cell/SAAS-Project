import { Link } from "../router/router.js";

/** Placeholder only -- real onboarding content/logic is Product Phase 1 Unit 6. "Continue" is a plain navigation stub. */
export function OnboardingPage() {
  return (
    <div className="screen">
      <p className="eyebrow">Onboarding</p>
      <h1 className="headline">A short onboarding sequence will live here.</h1>
      <p className="subtext">This screen is a placeholder for the real first-run onboarding flow (Product Phase 1, Unit 6).</p>
      <div className="btn-row">
        <Link to="/enroll" className="btn btn-primary">
          Continue
        </Link>
      </div>
    </div>
  );
}
