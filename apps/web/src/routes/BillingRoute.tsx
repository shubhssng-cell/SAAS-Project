import { useCallback, useEffect, useRef, useState } from "react";
import { apiGetBilling, apiRequestCancellation, apiStartCheckout, type BillingSummary } from "../billing/api.js";
import { BillingView, type BillingViewState } from "../billing/BillingView.js";
import { LoadingState } from "../design/index.js";
import { useNavigate } from "../router/router.js";

/** While a payment is waiting for the provider's confirmation, re-read the SERVER every few seconds (bounded). Display only. */
const POLL_INTERVAL_MS = 4000;
const POLL_MAX_ATTEMPTS = 15;

const FAILURE_COPY: Record<string, string> = {
  network_error: "We couldn't reach the server. Check your connection and try again.",
  not_authenticated: "Your session has ended. Please log in again.",
  rate_limited: "You're going a little fast. Please wait a moment and try again."
};

/**
 * The billing route. Everything shown is read from `GET /v1/billing`; the only things it can do are start a checkout for a plan id
 * the server listed and ask the provider to stop renewing. Following the checkout URL leaves this app for the provider's page.
 */
export function BillingRoute() {
  const navigate = useNavigate();
  const [state, setState] = useState<BillingViewState | null>(null);
  const [startingPlanId, setStartingPlanId] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const inFlight = useRef(false);
  const polls = useRef(0);
  const returning = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("checkout") === "return";

  const load = useCallback(async (): Promise<BillingSummary | null> => {
    const result = await apiGetBilling();
    if (result.ok) {
      setState({ status: "ready", summary: result.summary });
      return result.summary;
    }
    setState({ status: "error", message: FAILURE_COPY[result.failure.kind] ?? "Something went wrong. Please try again." });
    return null;
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    void load().then((summary) => {
      // Only a payment that is waiting for the provider's confirmation is worth re-reading; everything else is shown as it is.
      if (cancelled || summary?.subscription?.status !== "pending") return;
      timer = setInterval(() => {
        void apiGetBilling().then((result) => {
          if (cancelled || !result.ok) return;
          setState({ status: "ready", summary: result.summary });
          polls.current += 1;
          if (result.summary.subscription?.status !== "pending" || polls.current >= POLL_MAX_ATTEMPTS) clearInterval(timer);
        });
      }, POLL_INTERVAL_MS);
    });
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [load]);

  function startCheckout(planId: string): void {
    if (inFlight.current) return;
    inFlight.current = true;
    setNotice(null);
    setStartingPlanId(planId);
    void apiStartCheckout(planId).then((result) => {
      inFlight.current = false;
      if (result.ok) {
        window.location.assign(result.checkoutUrl);
        return;
      }
      setStartingPlanId(null);
      setNotice(result.failure.kind === "conflict" ? "You already have this plan." : result.failure.kind === "network_error" ? FAILURE_COPY.network_error! : result.failure.kind === "not_authenticated" ? FAILURE_COPY.not_authenticated! : "Payments aren't available right now. Please try again shortly.");
    });
  }

  function cancel(): void {
    if (inFlight.current) return;
    inFlight.current = true;
    setNotice(null);
    setCancelling(true);
    void apiRequestCancellation().then((result) => {
      inFlight.current = false;
      setCancelling(false);
      setNotice(result.ok ? "We've asked the payment provider to stop renewing. This page will show the change once they confirm." : "We couldn't request that right now. Please try again shortly.");
    });
  }

  if (!state) return <LoadingState message="Loading your plan…" />;
  return <BillingView state={state} returning={returning} startingPlanId={startingPlanId} cancelling={cancelling} notice={notice} onStartCheckout={startCheckout} onCancel={cancel} onRefresh={() => void load()} onBack={() => navigate("/dashboard")} />;
}
