import { useMemo, useRef } from "react";
import { createApiTrainingAdapter } from "./adapter/index.js";
import { AuthHeaderControl } from "./auth/AuthHeaderControl.js";
import { AuthProvider } from "./auth/AuthContext.js";
import { EnrollmentProvider } from "./enrollment/EnrollmentContext.js";
import { PracticeSessionProvider } from "./practice/PracticeSessionContext.js";
import { AppRoutes } from "./router/AppRoutes.js";
import { useRouteAccessibility } from "./router/RouteAccessibility.js";

/**
 * The application shell. Owns no flow/screen state of its own -- which
 * screen renders is entirely a function of the current URL (`AppRoutes`),
 * and every training decision still comes from `adapter.*` calls inside
 * the route components under `src/routes/` (via `PracticeSessionProvider`).
 * App.tsx never inspects evidence, evaluates applicability, or picks a
 * question itself; no component below `App.tsx` needed to change when the
 * fixture adapter was swapped for the real, HTTP-backed one (Product Phase
 * 1 Unit 10) -- see PHASE_1_PLATFORM_SHELL.md's Web Architecture Lock.
 *
 * `AuthProvider` (Product Phase 1 Unit 5) is the first real apps/web ->
 * apps/api connection -- it establishes presentation auth state from
 * `GET /v1/auth/me` on startup and is otherwise independent of
 * `PracticeSessionProvider`, which is now ALSO a real apps/web -> apps/api
 * connection as of Product Phase 1 Unit 10 (see below).
 *
 * `EnrollmentProvider` (Product Phase 1 Unit 7) is nested INSIDE
 * `AuthProvider` -- it reads `useAuth()`'s own state to decide when to
 * hydrate (only once authenticated) and reset (on logout), so it must
 * render below `AuthProvider` in the tree. It is otherwise independent of
 * `PracticeSessionProvider`, same as `AuthProvider` itself.
 *
 * `createApiTrainingAdapter()` (Product Phase 1 Unit 10) is the ONE place
 * the running app selects which `TrainingRecommendationAdapter`
 * implementation is live -- the real, HTTP-backed one, replacing the
 * fixture-backed `createFixtureTrainingAdapter()` this app used through
 * Unit 9. The fixture adapter still exists (`adapter/service.ts`,
 * `apps/web/test/service.test.ts`) for deterministic tests; it is no
 * longer constructed anywhere in this production runtime path.
 */
export function App() {
  const adapter = useMemo(() => createApiTrainingAdapter(), []);
  const mainRef = useRef<HTMLElement>(null);
  useRouteAccessibility(mainRef);

  return (
    <AuthProvider>
      <EnrollmentProvider>
        <PracticeSessionProvider adapter={adapter}>
          <div className="app-shell">
            <a className="skip-link" href="#main-content">
              Skip to main content
            </a>
            <header className="app-header">
              <div className="wordmark">
                IPMAT AI
                <small>Training</small>
              </div>
              <AuthHeaderControl />
            </header>

            <main className="app-main" id="main-content" tabIndex={-1} ref={mainRef}>
              <AppRoutes />
            </main>
          </div>
        </PracticeSessionProvider>
      </EnrollmentProvider>
    </AuthProvider>
  );
}
