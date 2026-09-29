import { Screen } from "../design/index.js";
import { Link } from "../router/router.js";

/** Placeholder only -- real IPMAT enrollment logic is Product Phase 1 Unit 7. "Continue" is a plain navigation stub. */
export function EnrollPage() {
  return (
    <Screen eyebrow="IPMAT enrollment" headline="Enrollment will happen here." subtext="This screen is a placeholder for real IPMAT enrollment (Product Phase 1, Unit 7).">
      <div className="btn-row">
        <Link to="/dashboard" className="btn btn-primary">
          Continue
        </Link>
      </div>
    </Screen>
  );
}
