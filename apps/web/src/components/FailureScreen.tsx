import { Button, Screen } from "../design/index.js";
import { useNavigate } from "../router/router.js";

/**
 * The one whole-screen error state for a failed practice/dashboard request (Product Phase 1
 * Unit 11) -- replaces four near-identical hand-written error screens. Always student-safe
 * copy (the caller supplies the headline; the body is fixed) and never an error object. A
 * genuine expired session (`sessionExpired`) offers "Log in" instead of a Retry that could
 * never succeed; every other failure offers Try again (when `onRetry` is given) plus a
 * way back. Retry re-runs the same request the route already made -- no logic of its own.
 */
export function FailureScreen({
  eyebrow,
  headline,
  sessionExpired = false,
  onRetry,
  back
}: {
  eyebrow: string;
  headline: string;
  sessionExpired?: boolean;
  onRetry?: () => void;
  back?: { label: string; to: string };
}) {
  const navigate = useNavigate();

  if (sessionExpired) {
    return (
      <Screen role="alert" eyebrow={eyebrow} headline="Your session has expired." subtext="Please log in again to continue.">
        <Button onClick={() => navigate("/login")}>Log in</Button>
      </Screen>
    );
  }

  return (
    <Screen role="alert" eyebrow={eyebrow} headline={headline} subtext="Something went wrong. Please try again.">
      <div className="btn-row btn-row-flush">
        {onRetry && <Button onClick={onRetry}>Try again</Button>}
        {back && (
          <Button variant={onRetry ? "secondary" : "primary"} onClick={() => navigate(back.to)}>
            {back.label}
          </Button>
        )}
      </div>
    </Screen>
  );
}
