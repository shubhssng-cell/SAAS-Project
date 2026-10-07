import { Button, Card, ErrorNotice, Screen } from "../design/index.js";
import type { BillingSummary } from "./api.js";
import { describePlanTerms, describeSubscription, describeUsage, FEATURE_LABELS } from "./copy.js";

/**
 * The student's plan, access and usage (Phase 9 Unit 4, D-100) -- a presentation of what the SERVER reported, with two actions the
 * student can take (start a checkout for a plan the server offers; ask to stop renewing). It computes no entitlement, price or
 * status of its own, claims no payment succeeded until the server says access is granted, and shows no payment details (the
 * payment itself happens on the provider's own page).
 */
export type BillingViewState = { status: "ready"; summary: BillingSummary } | { status: "error"; message: string };

export function BillingView({
  state,
  returning,
  startingPlanId,
  cancelling,
  notice,
  onStartCheckout,
  onCancel,
  onRefresh,
  onBack
}: {
  state: BillingViewState;
  /** The browser came back from the payment page (informational only: it proves nothing). */
  returning: boolean;
  startingPlanId: string | null;
  cancelling: boolean;
  notice: string | null;
  onStartCheckout: (planId: string) => void;
  onCancel: () => void;
  onRefresh: () => void;
  onBack: () => void;
}) {
  if (state.status === "error") {
    return (
      <Screen role="alert" eyebrow="Plan and usage" headline="We couldn't load your plan." subtext={state.message}>
        <div className="btn-row btn-row-flush">
          <Button onClick={onRefresh}>Try again</Button>
          <Button variant="secondary" onClick={onBack}>
            Back to dashboard
          </Button>
        </div>
      </Screen>
    );
  }

  const { summary } = state;
  const sub = summary.subscription;
  const copy = sub ? describeSubscription(sub) : null;
  const busy = startingPlanId !== null || cancelling;

  return (
    <Screen eyebrow="Plan and usage" headline="Your plan" subtext={summary.enforcement === "open" ? "Nothing is limited on this deployment right now." : "What your plan includes, and what you've used."}>
      {notice ? (
        <p className="subtext" role="status">
          {notice}
        </p>
      ) : null}
      {returning && (!sub || sub.status === "pending") ? (
        <p className="subtext" role="status">
          Thanks for coming back. We're confirming your payment with the payment provider — your access updates here once they confirm.
        </p>
      ) : null}

      <Card>
        <p className="mode-tag">Subscription</p>
        {copy && sub ? (
          <>
            <h2 className="headline headline-compact" data-tone={copy.tone}>
              {copy.headline}
            </h2>
            <p className="subtext">{copy.detail}</p>
            <div className="btn-row btn-row-flush">
              <Button variant="secondary" onClick={onRefresh} disabled={busy}>
                Check status
              </Button>
              {sub.canCancel ? (
                <Button variant="secondary" onClick={onCancel} disabled={busy}>
                  {cancelling ? "Requesting…" : "Stop renewing"}
                </Button>
              ) : null}
            </div>
          </>
        ) : (
          <p className="subtext">You don't have a paid plan.</p>
        )}
      </Card>

      {summary.access ? (
        <Card>
          <p className="mode-tag">What you can use</p>
          <div className="fact-row">
            <span className="fact-label">Your exam</span>
            <span className="fact-value">{summary.access.exam ? "Included" : "Not included"}</span>
          </div>
          {summary.access.features.map((f) => (
            <div className="fact-row" key={f.id}>
              <span className="fact-label">{FEATURE_LABELS[f.id]}</span>
              <span className="fact-value">{f.allowed ? "Included" : "Not included"}</span>
            </div>
          ))}
          {summary.usage.map((u) => (
            <p className="subtext" key={u.meter}>
              {describeUsage(u)}
            </p>
          ))}
        </Card>
      ) : (
        <Card>
          <p className="subtext">Finish enrollment to see what your plan includes for your exam.</p>
        </Card>
      )}

      {summary.plans.length > 0 && summary.enforcement === "enforced" ? (
        <Card>
          <p className="mode-tag">Plans</p>
          {summary.checkoutAvailable ? null : <p className="subtext">Payments aren't available right now.</p>}
          {summary.plans.map((plan) => (
            <div key={plan.id} className="plan-option">
              <h3 className="headline headline-compact">{plan.name}</h3>
              <p className="subtext">{plan.description}</p>
              <p className="subtext">{describePlanTerms(plan)}</p>
              <p className="subtext">Includes: {plan.features.map((f) => FEATURE_LABELS[f]).join(", ") || "core practice"}</p>
              {plan.provisional ? <p className="subtext">These terms are not final.</p> : null}
              <Button disabled={busy || !summary.checkoutAvailable} onClick={() => onStartCheckout(plan.id)}>
                {startingPlanId === plan.id ? "Opening payment page…" : "Choose this plan"}
              </Button>
            </div>
          ))}
          <p className="subtext">You'll pay on the payment provider's own page. We never see or store your card details.</p>
        </Card>
      ) : null}

      {summary.plans.length === 0 && summary.enforcement === "enforced" ? (
        <Card>
          <p className="mode-tag">Plans</p>
          <p className="subtext">Paid plans haven't been set up yet, so there is nothing to buy right now. What you can use today is shown above.</p>
        </Card>
      ) : null}

      <div className="btn-row btn-row-flush">
        <Button variant="secondary" onClick={onBack}>
          Back to dashboard
        </Button>
      </div>
    </Screen>
  );
}

export function BillingErrorNotice({ message }: { message: string }) {
  return <ErrorNotice>{message}</ErrorNotice>;
}
