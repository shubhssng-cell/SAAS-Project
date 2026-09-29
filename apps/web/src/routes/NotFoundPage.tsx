import { Link } from "../router/router.js";

/** Minimal not-found page. The full Unit 11 error-state system (empty/error states across every screen) is not built here. */
export function NotFoundPage() {
  return (
    <div className="screen">
      <p className="eyebrow">404</p>
      <h1 className="headline">We couldn't find that page.</h1>
      <p className="subtext">The link you followed doesn't match a route in this app.</p>
      <Link to="/dashboard" className="btn btn-primary">
        Go to dashboard
      </Link>
    </div>
  );
}
