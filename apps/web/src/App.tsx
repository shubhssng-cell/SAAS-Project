import { AuthHeaderControl } from "./auth/AuthHeaderControl.js";
import { AuthProvider } from "./auth/AuthContext.js";
import { EnrollmentProvider } from "./enrollment/EnrollmentContext.js";
import { PracticeSessionProvider } from "./practice/PracticeSessionContext.js";
import { AppRoutes } from "./router/AppRoutes.js";

/**
 * The application shell. Owns no flow/screen state of its own -- which
 * screen renders is entirely a function of the current URL (`AppRoutes`),
 * and every training decision still comes from `adapter.*` calls inside
 * the route components under `src/routes/` (via `PracticeSessionProvider`).
 * App.tsx never inspects evidence, evaluates applicability, or picks a
 * question itself; it never changes when the adapter's fixture
 * implementation is swapped for a real one (Product Phase 1 Unit 10) --
 * see PHASE_1_PLATFORM_SHELL.md's Web Architecture Lock.
 *
 * `AuthProvider` (Product Phase 1 Unit 5) is the first real apps/web ->
 * apps/api connection -- it establishes presentation auth state from
 * `GET /v1/auth/me` on startup and is otherwise independent of
 * `PracticeSessionProvider`, which remains entirely fixture-backed.
 *
 * `EnrollmentProvider` (Product Phase 1 Unit 7) is nested INSIDE
 * `AuthProvider` -- it reads `useAuth()`'s own state to decide when to
 * hydrate (only once authenticated) and reset (on logout), so it must
 * render below `AuthProvider` in the tree. It is otherwise independent of
 * `PracticeSessionProvider`, same as `AuthProvider` itself.
 */
export function App() {
  return (
    <AuthProvider>
      <EnrollmentProvider>
        <PracticeSessionProvider>
          <div className="app-shell">
            <header className="app-header">
              <div className="wordmark">
                IPMAT AI
                <small>Training</small>
              </div>
              <AuthHeaderControl />
            </header>

            <main className="app-main">
              <AppRoutes />
            </main>
          </div>
        </PracticeSessionProvider>
      </EnrollmentProvider>
    </AuthProvider>
  );
}
