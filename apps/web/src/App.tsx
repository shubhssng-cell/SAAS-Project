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
 */
export function App() {
  return (
    <PracticeSessionProvider>
      <div className="app-shell">
        <header className="app-header">
          <div className="wordmark">
            IPMAT AI
            <small>Training</small>
          </div>
        </header>

        <main className="app-main">
          <AppRoutes />
        </main>
      </div>
    </PracticeSessionProvider>
  );
}
