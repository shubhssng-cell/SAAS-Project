import { useState } from "react";
import { useAuth } from "../auth/AuthContext.js";
import { Button, Card, Screen } from "../design/index.js";
import { useNavigate } from "../router/router.js";

/**
 * One-screen onboarding (Product Phase 1 Unit 6) -- explains the product
 * benefit only, never internal architecture (no "Question DNA," "Examiner
 * Lens," "RepairPlan," mastery algorithms, taxonomies, etc.). Every claim
 * below is about OBSERVABLE things (answers, timing, repeated mistakes,
 * question patterns) -- never a claim about confidence, motivation, or any
 * other inferred mental state (the same D-005 discipline the backend
 * already enforces everywhere else).
 */
const SECTIONS = [
  {
    heading: "Prepare differently.",
    body: "This isn't just a question bank. The platform is built around mastery -- not how many questions you've clicked through."
  },
  {
    heading: "Your practice learns from your attempts.",
    body: "As you practice, the system observes what actually happened: which answers you chose, how long each question took, and where the same kind of mistake shows up more than once."
  },
  {
    heading: "Train for the actual exam.",
    body: "Over time, practice can progressively target specific concepts, your solving speed, common traps, unfamiliar question styles, and performance under time pressure."
  }
];

export function OnboardingPage() {
  const { completeOnboarding } = useAuth();
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleStart() {
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      const result = await completeOnboarding();
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
    <Screen eyebrow="Getting started" headline="A quick look before you start.">
      <Card>
        {SECTIONS.map((section) => (
          <div key={section.heading} className="onboarding-section">
            <h2 className="onboarding-section-heading">{section.heading}</h2>
            <p className="subtext onboarding-section-body">{section.body}</p>
          </div>
        ))}
        {error && (
          <p className="form-alert" role="alert">
            {error}
          </p>
        )}
        <Button block disabled={submitting} onClick={handleStart}>
          {submitting ? "Starting…" : "Start preparing"}
        </Button>
      </Card>
    </Screen>
  );
}
