import { Screen } from "../design/index.js";
import { Link } from "../router/router.js";

/** Not-found page for any URL that matches no route. Student-safe wording; the way back is the dashboard (which sends a logged-out visitor to log in). */
export function NotFoundPage() {
  return (
    <Screen eyebrow="404" headline="We couldn't find that page." subtext="The link may be broken, or the page may have moved.">
      <Link to="/dashboard" className="btn btn-primary">
        Go to dashboard
      </Link>
    </Screen>
  );
}
