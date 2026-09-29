import { Link } from "../router/router.js";

export function LandingPage() {
  return (
    <div className="screen">
      <p className="eyebrow">IPMAT AI Training</p>
      <h1 className="headline">Practice with a system that tells you what to do next.</h1>
      <p className="subtext">Instead of grinding through random questions, this platform watches how you actually perform and recommends what to practice next, based on real evidence.</p>
      <div className="btn-row">
        <Link to="/login" className="btn btn-primary">
          Log in
        </Link>
        <Link to="/signup" className="btn btn-secondary">
          Sign up
        </Link>
      </div>
    </div>
  );
}
