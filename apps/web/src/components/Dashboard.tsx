import type { DashboardViewModel } from "../adapter/index.js";
import { formatEnrolledDate, greetingSubtext, practiceProgressNote, type PrepStatusViewModel } from "../dashboard/prepStatus.js";
import { Card, Screen } from "../design/index.js";
import { RecommendationCard } from "./RecommendationCard.js";

/**
 * The real student dashboard (Product Phase 1 Unit 8). Deliberately
 * lightweight: a greeting, the student's real enrollment/prep-phase
 * status (server-derived, `@ipmat/enrollment-api` via `useEnrollment()`),
 * and ONE obvious primary action. No analytics, no charts, no fabricated
 * readiness claim — see `../dashboard/prepStatus.ts`'s own doc comments
 * for what is and isn't shown and why. `dashboard.recommendation` and
 * `onStart` are untouched from the pre-Unit-8 shape — the fixture-backed
 * practice recommendation itself is exactly as Unit 5 left it.
 */
export function Dashboard({
  dashboard,
  studentEmail,
  prepStatus,
  onStart
}: {
  dashboard: DashboardViewModel;
  studentEmail: string;
  prepStatus: PrepStatusViewModel;
  onStart: () => void;
}) {
  return (
    <Screen eyebrow="Dashboard" headline="Welcome back." subtext={greetingSubtext(studentEmail)}>
      <Card>
        <p className="mode-tag">Your preparation</p>
        <div className="fact-row">
          <span className="fact-label">Enrolled since</span>
          <span className="fact-value">{formatEnrolledDate(prepStatus.enrolledAt)}</span>
        </div>
        <div className="fact-row">
          <span className="fact-label">Days to exam</span>
          <span className="fact-value">{prepStatus.daysToExamToday}</span>
        </div>
      </Card>

      <p className="subtext dashboard-practice-note">{practiceProgressNote(dashboard.questionsPracticedSoFar)}</p>

      <RecommendationCard recommendation={dashboard.recommendation} actionLabel="Start Practice" onAction={onStart} />
    </Screen>
  );
}
