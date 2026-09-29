import { useState } from "react";
import { Button, Card, Screen } from "../design/index.js";
import { useEnrollment } from "../enrollment/EnrollmentContext.js";
import { useNavigate } from "../router/router.js";

/**
 * Real IPMAT enrollment (Product Phase 1 Unit 7) -- replaces the Unit 2
 * placeholder. Collects NO input: the existing `Enrollment`/`computePrepPhase`
 * domain model needs only `studentId` (server-resolved from the session)
 * and `examId` (server-resolved from the one exam this product currently
 * supports) -- there is nothing genuinely required to ask the student for,
 * so this screen doesn't invent a field just to look more complete.
 */
export function EnrollPage() {
  const { enroll } = useEnrollment();
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleEnroll() {
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      const result = await enroll();
      if (result.ok) {
        navigate("/dashboard");
        return;
      }
      setError(result.failure.kind === "network_error" ? "We couldn't reach the server. Check your connection and try again." : "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Screen eyebrow="IPMAT preparation" headline="You're setting up your IPMAT preparation.">
      <Card>
        <p className="subtext">Enrolling establishes your preparation context — the platform uses your enrollment date to structure training against a realistic timeline as your exam approaches.</p>
        {error && (
          <p className="form-alert" role="alert">
            {error}
          </p>
        )}
        <Button block disabled={submitting} onClick={handleEnroll}>
          {submitting ? "Enrolling…" : "Enroll for IPMAT"}
        </Button>
      </Card>
    </Screen>
  );
}
