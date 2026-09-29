import { decideOnboardingGateAccess, type OnboardingGateMode } from "../auth/routeAccess.js";
import type { EnrollmentState } from "./enrollmentState.js";

export type EnrollmentGateDecision = "render" | "redirect" | "unresolved";

/**
 * Translates `EnrollmentState`'s status into the enrollment gate's
 * decision — a small, dedicated, pure function (unit-testable on its
 * own), rather than an inline ternary chain living inside
 * `EnrollmentGate.tsx`. Delegates the actual render/redirect boolean
 * logic to the EXISTING `decideOnboardingGateAccess()`
 * (`../auth/routeAccess.js`) -- that function is already generic
 * ("boolean satisfied + mode -> render/redirect"), so this file adds
 * ONLY the enrollment-specific translation (which `EnrollmentState`
 * statuses even count as "resolved"), never a duplicate copy of the
 * render/redirect rule itself. `"unresolved"` (idle/loading/error) never
 * redirects -- only `"enrolled"`/`"not-enrolled"` are resolved enough to
 * decide anything.
 */
export function decideEnrollmentGateAccess(status: EnrollmentState["status"], mode: OnboardingGateMode): EnrollmentGateDecision {
  if (status === "enrolled") return decideOnboardingGateAccess(true, mode);
  if (status === "not-enrolled") return decideOnboardingGateAccess(false, mode);
  return "unresolved";
}
