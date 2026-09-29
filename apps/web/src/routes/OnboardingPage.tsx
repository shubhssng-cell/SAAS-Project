import { Screen } from "../design/index.js";
import { Link } from "../router/router.js";

/** Placeholder only -- real onboarding content/logic is Product Phase 1 Unit 6. "Continue" is a plain navigation stub. */
export function OnboardingPage() {
  return (
    <Screen eyebrow="Onboarding" headline="A short onboarding sequence will live here." subtext="This screen is a placeholder for the real first-run onboarding flow (Product Phase 1, Unit 6).">
      <div className="btn-row">
        <Link to="/enroll" className="btn btn-primary">
          Continue
        </Link>
      </div>
    </Screen>
  );
}
