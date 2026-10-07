import type { AuthFailure } from "../auth/failureMapping.js";
import { jsonRequest, type FetchLike } from "../http.js";

/**
 * Whether a full-exam simulation is configured for the student's exam (Phase 9 Unit 5, D-101). The server answers; the browser never
 * decides. The repository ships no exam rules, so until the owner supplies a configuration the answer is `false`. This call starts
 * nothing and uses none of the student's allowance.
 */
export type SimulationAvailabilityResult = { ok: true; available: boolean } | { ok: false; failure: AuthFailure };

export async function apiGetSimulationAvailability(fetchImpl: FetchLike = fetch): Promise<SimulationAvailabilityResult> {
  const result = await jsonRequest(fetchImpl, "GET", "/v1/simulations/availability");
  if (!result.ok) return result;
  const body = result.body;
  const available = typeof body === "object" && body !== null ? (body as { available?: unknown }).available : undefined;
  return typeof available === "boolean" ? { ok: true, available } : { ok: false, failure: { kind: "unexpected", message: "Something went wrong. Please try again." } };
}
