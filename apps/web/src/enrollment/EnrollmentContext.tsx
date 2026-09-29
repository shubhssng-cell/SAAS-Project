import { createContext, useContext, useEffect, useMemo, useReducer, useRef, type ReactNode } from "react";
import { useAuth } from "../auth/AuthContext.js";
import { createOperationGuard } from "../auth/operationGuard.js";
import { apiEnroll, apiGetEnrollment, type EnrollResult } from "./api.js";
import { enrollmentReducer, type EnrollmentState } from "./enrollmentState.js";

/**
 * The enrollment client/state abstraction (Product Phase 1 Unit 7) --
 * mirrors `AuthContext.tsx`'s own shape (pure reducer + operation guard),
 * but is a SEPARATE context: enrollment is a genuinely separate aggregate
 * from Student/Session (see the Unit 7 architecture notes in
 * PHASE_1_PLATFORM_SHELL.md for why it was not folded into `/v1/auth/me`).
 *
 * Hydration is driven by `useAuth()`'s OWN state, not an independent
 * mount effect: enrollment status is fetched only once `authState.status
 * === "authenticated"` (fetching earlier would be a request that can only
 * ever fail with 401), and is reset to `"idle"` whenever auth stops being
 * authenticated (e.g. logout) -- never left showing a stale enrolled/not-
 * enrolled status for a different or no-longer-authenticated student.
 */
interface EnrollmentContextValue {
  state: EnrollmentState;
  enroll: () => Promise<EnrollResult>;
}

const EnrollmentContext = createContext<EnrollmentContextValue | null>(null);

export function EnrollmentProvider({ children }: { children: ReactNode }) {
  const { state: authState } = useAuth();
  const [state, dispatch] = useReducer(enrollmentReducer, { status: "idle" });
  const guard = useRef(createOperationGuard()).current;

  useEffect(() => {
    if (authState.status !== "authenticated") {
      // Bumping the guard here too (not just dispatching RESET) invalidates any
      // still-in-flight fetch/enroll from before logout -- without this, a stale
      // request resolving AFTER logout could still pass its own isCurrent() check
      // and silently re-apply a previous student's enrollment state.
      guard.next();
      dispatch({ type: "RESET" });
      return;
    }
    const token = guard.next();
    dispatch({ type: "FETCH_START" });
    apiGetEnrollment().then((result) => {
      if (!guard.isCurrent(token)) return; // a newer fetch/enroll started meanwhile -- its own result already governs state.
      if (!result.ok) {
        const message = result.failure.kind === "network_error" ? "We couldn't reach the server. Check your connection and try again." : result.failure.kind === "not_authenticated" ? "You are not logged in." : "Something went wrong. Please try again.";
        dispatch({ type: "FETCH_ERROR", message });
        return;
      }
      if (result.enrollment && result.prepPhase) {
        dispatch({ type: "FETCH_ENROLLED", enrollment: result.enrollment, prepPhase: result.prepPhase });
      } else {
        dispatch({ type: "FETCH_NOT_ENROLLED" });
      }
    });
  }, [authState.status, guard]);

  const value = useMemo<EnrollmentContextValue>(
    () => ({
      state,
      async enroll() {
        const token = guard.next();
        const result = await apiEnroll();
        if (result.ok && guard.isCurrent(token)) dispatch({ type: "ENROLLED", enrollment: result.enrollment, prepPhase: result.prepPhase });
        return result;
      }
    }),
    [state, guard]
  );

  return <EnrollmentContext.Provider value={value}>{children}</EnrollmentContext.Provider>;
}

export function useEnrollment(): EnrollmentContextValue {
  const ctx = useContext(EnrollmentContext);
  if (!ctx) throw new Error("useEnrollment must be used within EnrollmentProvider");
  return ctx;
}
