import { useEffect, useState } from "react";
import { apiGetSimulationAvailability } from "../simulation/api.js";
import { Card } from "../design/index.js";

/**
 * The dashboard's honest statement about full-exam simulations (Phase 9 Unit 5, D-101). A simulation needs the exam's official format
 * (duration, sections, question counts), which this product does not invent; until the owner supplies it the server reports
 * "not configured" and this card says so plainly - no button that can only fail, no pretend feature. Even when the server reports a
 * configuration, the in-app simulation screens are not part of this release, and the card says that too.
 */
export type SimulationCardState = { status: "loading" } | { status: "unavailable" } | { status: "configured" } | { status: "error" };

/** The card state for the server's answer (a failure or malformed answer is never read as "configured"). */
export function simulationCardState(result: { ok: true; available: boolean } | { ok: false }): SimulationCardState {
  return result.ok ? { status: result.available ? "configured" : "unavailable" } : { status: "error" };
}

export function SimulationCardView({ state }: { state: SimulationCardState }) {
  return (
    <Card>
      <p className="mode-tag">Full exam simulation</p>
      {state.status === "loading" ? (
        <p className="subtext" role="status">
          Checking…
        </p>
      ) : state.status === "unavailable" ? (
        <>
          <h2 className="headline headline-compact">Not available yet.</h2>
          <p className="subtext">A full-length simulation needs the exam's official format (duration, sections and question counts), and that hasn't been set up for your exam yet. Nothing is wrong with your account — practice and training are not affected.</p>
        </>
      ) : state.status === "configured" ? (
        <>
          <h2 className="headline headline-compact">Coming to the app.</h2>
          <p className="subtext">A simulation format exists for your exam, but the in-app simulation screens are not part of this release yet.</p>
        </>
      ) : (
        <p className="subtext">We couldn't check simulation availability right now.</p>
      )}
    </Card>
  );
}

export function SimulationCard() {
  const [state, setState] = useState<SimulationCardState>({ status: "loading" });
  useEffect(() => {
    let cancelled = false;
    void apiGetSimulationAvailability().then((result) => {
      if (cancelled) return;
      setState(simulationCardState(result));
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return <SimulationCardView state={state} />;
}
