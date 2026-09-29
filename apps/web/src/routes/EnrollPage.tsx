import { Link } from "../router/router.js";

/** Placeholder only -- real IPMAT enrollment logic is Product Phase 1 Unit 7. "Continue" is a plain navigation stub. */
export function EnrollPage() {
  return (
    <div className="screen">
      <p className="eyebrow">IPMAT enrollment</p>
      <h1 className="headline">Enrollment will happen here.</h1>
      <p className="subtext">This screen is a placeholder for real IPMAT enrollment (Product Phase 1, Unit 7).</p>
      <div className="btn-row">
        <Link to="/dashboard" className="btn btn-primary">
          Continue
        </Link>
      </div>
    </div>
  );
}
