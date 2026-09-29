import { Screen } from "../design/index.js";
import { Link } from "../router/router.js";

/** Minimal not-found page. The full Unit 11 error-state system (empty/error states across every screen) is not built here. */
export function NotFoundPage() {
  return (
    <Screen eyebrow="404" headline="We couldn't find that page." subtext="The link you followed doesn't match a route in this app.">
      <Link to="/dashboard" className="btn btn-primary">
        Go to dashboard
      </Link>
    </Screen>
  );
}
