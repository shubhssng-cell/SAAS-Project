import { Screen } from "../design/index.js";
import { Link } from "../router/router.js";

export function LandingPage() {
  return (
    <Screen
      eyebrow="IPMAT AI Training"
      headline="Practice with a system that tells you what to do next."
      subtext="Instead of grinding through random questions, this platform watches how you actually perform and recommends what to practice next, based on real evidence."
    >
      <div className="btn-row">
        <Link to="/login" className="btn btn-primary">
          Log in
        </Link>
        <Link to="/signup" className="btn btn-secondary">
          Sign up
        </Link>
      </div>
    </Screen>
  );
}
