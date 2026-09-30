import { readdirSync, readFileSync } from "node:fs";
import { join, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Enforces PHASE_1_PLATFORM_SHELL.md's "Web Architecture Lock" for every
 * file introduced or touched by Product Phase 1 Unit 2 -- the new
 * routing/shell layer must never import a domain package, a selection
 * engine, a training-system provider, `@ipmat/db`, or Prisma directly.
 *
 * `src/adapter/{service,fixtures,presentation}.ts` (the fixture-backed
 * `TrainingRecommendationAdapter` and its own supporting fixture/
 * presentation data) are deliberately excluded from this scan -- they
 * legitimately import domain packages directly to build deterministic
 * fixture data for tests (Product Phase 1 Unit 10 retired this trio from
 * the PRODUCTION runtime path -- see the "Practice API integration" block
 * below -- but they still exist, and still need those imports, for
 * `apps/web/test/service.test.ts` and any future fixture-specific use).
 * `src/adapter/{apiTrainingAdapter,index,types}.ts` are NOT excluded --
 * those must stay clean. This test guards against NEW violations, it does
 * not re-litigate the tracked one.
 */

const SCANNED_DIRS = ["src/router", "src/routes", "src/design", "src/components", "src/auth", "src/enrollment", "src/dashboard", "src/practice", "src/adapter"];
const EXCLUDED_FILES: string[] = ["src/adapter/service.ts", "src/adapter/fixtures.ts", "src/adapter/presentation.ts"];

const BANNED_IMPORT_SPECIFIERS = [
  "@ipmat/attempt",
  "@ipmat/autopsy",
  "@ipmat/mastery",
  "@ipmat/training-orchestration",
  "@ipmat/adaptive-selection",
  "@ipmat/repair-selection",
  "@ipmat/training-systems",
  "@ipmat/calculation-gym",
  "@ipmat/speed-lab",
  "@ipmat/trap-lab",
  "@ipmat/novelty-training",
  "@ipmat/pressure-training",
  "@ipmat/practice-loop",
  "@ipmat/training-recommendation",
  "@ipmat/db",
  "@ipmat/ai",
  // Product Phase 1 Unit 5 -- apps/web talks to auth only over the /v1/auth/*
  // HTTP boundary (src/auth/api.ts); it must never import the auth
  // domain/application packages themselves.
  "@ipmat/auth",
  "@ipmat/auth-api",
  // Product Phase 1 Unit 7 -- same discipline for enrollment/prep-phase: apps/web
  // talks to /v1/enrollment only, never these packages, and never computePrepPhase()
  // directly (that stays exclusively server-side).
  "@ipmat/enrollment-api",
  "@ipmat/prep-phase",
  "@prisma/client"
];

function listSourceFiles(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listSourceFiles(path));
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      files.push(path);
    }
  }
  return files;
}

const webRoot = join(__dirname, "..");
const scannedFiles = SCANNED_DIRS.flatMap((dir) => listSourceFiles(join(webRoot, dir))).filter(
  (path) => !EXCLUDED_FILES.some((excluded) => path.replace(/\\/g, "/").endsWith(excluded))
);

describe("Web Architecture Lock -- routing/shell layer never imports a domain package directly", () => {
  it("scanned at least the expected route/router files", () => {
    // Sanity check that the scan itself is actually finding files, not silently scanning nothing.
    expect(scannedFiles.length).toBeGreaterThanOrEqual(15);
  });

  it.each(BANNED_IMPORT_SPECIFIERS)('no file under src/router or src/routes imports "%s"', (specifier) => {
    const offenders = scannedFiles.filter((path) => {
      const source = readFileSync(path, "utf-8");
      const importPattern = new RegExp(`from\\s+["']${specifier.replace("/", "\\/")}["']`);
      return importPattern.test(source);
    });
    expect(offenders).toEqual([]);
  });
});

describe("Auth: the browser never reads/stores a raw session token itself (Product Phase 1 Unit 5)", () => {
  it("no scanned file uses localStorage, sessionStorage, or reads document.cookie", () => {
    const offenders: string[] = [];
    for (const path of scannedFiles) {
      const source = readFileSync(path, "utf-8");
      if (/localStorage|sessionStorage|document\.cookie/.test(source)) {
        offenders.push(path);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("src/auth/api.ts sends credentials: \"include\" and never sets an Authorization/Cookie header itself", () => {
    const source = readFileSync(join(webRoot, "src/auth/api.ts"), "utf-8");
    expect(source).toContain('credentials: "include"');
    expect(source).not.toMatch(/["']authorization["']/i);
    expect(source).not.toMatch(/["']cookie["']/i);
  });

  it("api.ts is the ONLY file that calls fetch() for /v1/auth/* -- every other auth file goes through it", () => {
    const authDir = join(webRoot, "src/auth");
    const files = readdirSync(authDir).filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"));
    for (const file of files) {
      if (file === "api.ts") continue;
      const source = readFileSync(join(authDir, file), "utf-8");
      expect(source, `${file} must not call fetch() directly`).not.toMatch(/\bfetch\(/);
    }
  });
});

describe("Enrollment: the browser never chooses which student is enrolled (Product Phase 1 Unit 7)", () => {
  const enrollmentDir = join(webRoot, "src/enrollment");

  it("enrollment/api.ts posts no body to /v1/enrollment -- structurally cannot send a studentId", () => {
    const source = readFileSync(join(enrollmentDir, "api.ts"), "utf-8");
    expect(source).toContain("jsonRequest");
    // apiEnroll()/apiGetEnrollment() call jsonRequest(fetchImpl, method, path) with no 4th
    // (body) argument at all -- confirmed structurally: neither call site passes a 4th
    // argument, and there is no JSON.stringify/request-body construction anywhere in this
    // file, so there is no code path through which a studentId (or anything else) could be
    // sent as a request body.
    expect(source).toMatch(/jsonRequest\(fetchImpl,\s*"GET",\s*"\/v1\/enrollment"\)/);
    expect(source).toMatch(/jsonRequest\(fetchImpl,\s*"POST",\s*"\/v1\/enrollment"\)/);
    expect(source).not.toContain("JSON.stringify");
  });

  it("api.ts is the ONLY file in src/enrollment that calls fetch() -- every other file goes through it", () => {
    const files = readdirSync(enrollmentDir).filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"));
    for (const file of files) {
      if (file === "api.ts") continue;
      const source = readFileSync(join(enrollmentDir, file), "utf-8");
      expect(source, `${file} must not call fetch() directly`).not.toMatch(/\bfetch\(/);
    }
  });

  it("EnrollmentGate never redirects for an unresolved status (structural check: 'unresolved' only ever maps to a non-navigating render path)", () => {
    const source = readFileSync(join(enrollmentDir, "EnrollmentGate.tsx"), "utf-8");
    expect(source).toContain('decision === "redirect"');
    expect(source).not.toContain('decision === "unresolved"'); // never explicitly branches into a redirect for this case
  });
});

describe("Dashboard: real student/enrollment context, no fabricated data, no new fetch mechanism (Product Phase 1 Unit 8)", () => {
  const routesDir = join(webRoot, "src/routes");
  const componentsDir = join(webRoot, "src/components");

  it("DashboardRoute reads student identity/enrollment from the EXISTING contexts, never a new fetch call", () => {
    const source = readFileSync(join(routesDir, "DashboardRoute.tsx"), "utf-8");
    expect(source).toContain("useAuth");
    expect(source).toContain("useEnrollment");
    expect(source).not.toMatch(/\bfetch\(/);
  });

  it("DashboardRoute still calls the SAME unmodified fixture adapter for the practice recommendation preview (adapter.getDashboard)", () => {
    const source = readFileSync(join(routesDir, "DashboardRoute.tsx"), "utf-8");
    expect(source).toContain("usePracticeSession");
    expect(source).toContain("adapter.getDashboard()");
  });

  it("DashboardRoute's Start Practice action hands off to the real practice-entry boundary (/practice/next), never a dashboard-chosen question id (Product Phase 1 Unit 9)", () => {
    const source = readFileSync(join(routesDir, "DashboardRoute.tsx"), "utf-8");
    expect(source).toMatch(/navigate\(["']\/practice\/next["']\)/);
    expect(source).not.toMatch(/dashboard\.recommendation\.questionId/);
    expect(source).not.toContain("q-reverse-1");
  });

  it("Dashboard.tsx composes the EXISTING RecommendationCard rather than reimplementing the recommendation display", () => {
    expect(readFileSync(join(componentsDir, "Dashboard.tsx"), "utf-8")).toContain('from "./RecommendationCard.js"');
  });

  it("Dashboard.tsx only ever receives the narrow PrepStatusViewModel -- never the raw EnrollmentDto/PrepPhaseDto (which carry examId/enrollment id/raw field names)", () => {
    const source = readFileSync(join(componentsDir, "Dashboard.tsx"), "utf-8");
    expect(source).not.toMatch(/EnrollmentDto|PrepPhaseDto/);
    expect(source).toContain("PrepStatusViewModel");
  });

  it("Dashboard.tsx never fabricates a readiness/confidence claim or hardcodes a percentage in its own source", () => {
    const source = readFileSync(join(componentsDir, "Dashboard.tsx"), "utf-8");
    expect(source.toLowerCase()).not.toMatch(/confidence|% ready|ai recommends|weakest area/);
  });
});

describe("Practice entry: the real dashboard -> practice transition, no second decision engine (Product Phase 1 Unit 9)", () => {
  const routesDir = join(webRoot, "src/routes");
  const practiceDir = join(webRoot, "src/practice");

  it("PracticeNextRoute asks the EXISTING adapter for the next item, never a new fetch call or a second recommendation engine", () => {
    const source = readFileSync(join(routesDir, "PracticeNextRoute.tsx"), "utf-8");
    expect(source).toContain("usePracticeSession");
    expect(source).toMatch(/adapter\s*\.getNextRecommendation\(\)/);
    expect(source).not.toMatch(/\bfetch\(/);
  });

  it("PracticeNextRoute shows an explicit, non-blank loading state while resolving", () => {
    const source = readFileSync(join(routesDir, "PracticeNextRoute.tsx"), "utf-8");
    expect(source).toContain("Finding your next question");
  });

  it("PracticeNextRoute navigates to the resolved question's own id via decidePracticeEntryOutcome, never a hardcoded fallback", () => {
    const source = readFileSync(join(routesDir, "PracticeNextRoute.tsx"), "utf-8");
    expect(source).toContain("decidePracticeEntryOutcome");
    expect(source).toMatch(/navigate\(`\/practice\/\$\{outcome\.questionId\}`\)/);
    expect(source).not.toContain("q-reverse-1");
  });

  it("PracticeNextRoute has an explicit unavailable state with a recovery action -- never implies a recommendation exists when it doesn't", () => {
    const source = readFileSync(join(routesDir, "PracticeNextRoute.tsx"), "utf-8");
    expect(source).toContain("PRACTICE_UNAVAILABLE_COPY.headline"); // the copy itself lives in practice/practiceEntry.ts (asserted in practiceEntry.test.ts)
    expect(source).toContain('navigate("/dashboard")');
  });

  it("PracticeNextRoute has an explicit error state with a recovery action, and never exposes raw internals", () => {
    const source = readFileSync(join(routesDir, "PracticeNextRoute.tsx"), "utf-8");
    expect(source).toContain(".catch(");
    expect(source).toContain("FailureScreen"); // renders the shared error state, whose "Try again" is asserted under Unit 11 below
    expect(source).toContain("onRetry");
    expect(source.toLowerCase()).not.toMatch(/stack|json\.stringify|error\.message/);
  });

  it("decidePracticeEntryOutcome is a pure function -- no React, no fetch, no adapter import", () => {
    const source = readFileSync(join(practiceDir, "practiceEntry.ts"), "utf-8");
    expect(source).not.toMatch(/\breact\b/i);
    expect(source).not.toMatch(/\bfetch\(/);
    expect(source).not.toContain("createFixtureTrainingAdapter");
  });
});

describe("Practice API integration: the real HTTP-backed adapter, fixture adapter retired from the runtime path (Product Phase 1 Unit 10)", () => {
  const adapterDir = join(webRoot, "src/adapter");
  const appSource = readFileSync(join(webRoot, "src/App.tsx"), "utf-8");

  it("App.tsx selects createApiTrainingAdapter() for the running app -- the ONE place a runtime adapter is chosen", () => {
    expect(appSource).toContain("createApiTrainingAdapter");
    expect(appSource).toContain("PracticeSessionProvider adapter={adapter}");
  });

  it("App.tsx never imports or invokes the fixture adapter -- createFixtureTrainingAdapter is retired from the production runtime path", () => {
    expect(appSource).not.toMatch(/import\s*\{[^}]*createFixtureTrainingAdapter/);
    expect(appSource).not.toMatch(/[=(]\s*createFixtureTrainingAdapter\(\)/); // an actual assignment/call, not a doc-comment mention
  });

  it("PracticeSessionContext.tsx no longer constructs its own fixture adapter internally -- it only accepts one as a prop", () => {
    const source = readFileSync(join(webRoot, "src/practice/PracticeSessionContext.tsx"), "utf-8");
    expect(source).not.toContain("createFixtureTrainingAdapter");
    expect(source).not.toMatch(/\bfetch\(/);
  });

  it("apiTrainingAdapter.ts uses ONLY the shared jsonRequest()/http.ts transport -- never a raw fetch() of its own", () => {
    const source = readFileSync(join(adapterDir, "apiTrainingAdapter.ts"), "utf-8");
    expect(source).toContain("jsonRequest");
    expect(source).not.toMatch(/(?<!json)fetch\(/); // no bare fetch() call outside the jsonRequest()/FetchLike plumbing
  });

  it("apiTrainingAdapter.ts never constructs a request body containing a studentId/enrollmentId field", () => {
    const source = readFileSync(join(adapterDir, "apiTrainingAdapter.ts"), "utf-8");
    expect(source).not.toMatch(/\bstudentId\s*:/);
    expect(source).not.toMatch(/\benrollmentId\s*:/);
  });

  it("apiTrainingAdapter.ts contains no recommendation/adaptive/grading/repair decision logic of its own -- transport translation only", () => {
    const source = readFileSync(join(adapterDir, "apiTrainingAdapter.ts"), "utf-8");
    expect(source).not.toMatch(/orchestrat|selectNextQuestion|computeMastery|buildRepairPlan|generateHypothesis/i);
  });

  it("the fixture adapter (service.ts) still exists for tests/fixtures, unmodified, but is no longer imported by any production route/component outside src/adapter itself", () => {
    const offenders: string[] = [];
    for (const path of scannedFiles) {
      if (path.includes(`${sep}adapter${sep}`)) continue; // src/adapter's own barrel/type files legitimately reference the fixture factory's name (export + historical doc comment)
      const source = readFileSync(path, "utf-8");
      if (source.includes("createFixtureTrainingAdapter")) offenders.push(path);
    }
    expect(offenders).toEqual([]);
  });
});

describe("Route components compose existing presentation components rather than rewriting them", () => {
  const routesDir = join(webRoot, "src/routes");

  it("DashboardRoute reuses the existing Dashboard component", () => {
    expect(readFileSync(join(routesDir, "DashboardRoute.tsx"), "utf-8")).toContain('from "../components/Dashboard.js"');
  });

  it("PracticeQuestionRoute reuses the existing QuestionPlayer component", () => {
    expect(readFileSync(join(routesDir, "PracticeQuestionRoute.tsx"), "utf-8")).toContain('from "../components/QuestionPlayer.js"');
  });

  it("PracticeResultRoute reuses the existing ResultScreen component", () => {
    expect(readFileSync(join(routesDir, "PracticeResultRoute.tsx"), "utf-8")).toContain('from "../components/ResultScreen.js"');
  });

  it("PracticeAutopsyRoute reuses the existing AutopsyCard component", () => {
    expect(readFileSync(join(routesDir, "PracticeAutopsyRoute.tsx"), "utf-8")).toContain('from "../components/AutopsyCard.js"');
  });

  it("PracticeNextRoute reuses the existing NextTrainingCard component", () => {
    expect(readFileSync(join(routesDir, "PracticeNextRoute.tsx"), "utf-8")).toContain('from "../components/NextTrainingCard.js"');
  });

  it("all real (non-placeholder) route components go through the shared adapter via usePracticeSession, never a fresh adapter instance", () => {
    const realRouteFiles = ["DashboardRoute.tsx", "PracticeQuestionRoute.tsx", "PracticeResultRoute.tsx", "PracticeAutopsyRoute.tsx", "PracticeNextRoute.tsx"];
    for (const file of realRouteFiles) {
      const source = readFileSync(join(routesDir, file), "utf-8");
      expect(source).toContain("usePracticeSession");
      expect(source).not.toContain("createFixtureTrainingAdapter");
    }
  });
});

describe("Shell hardening: loading/error/empty/accessibility structure (Product Phase 1 Unit 11)", () => {
  const src = (path: string) => readFileSync(join(webRoot, "src", path), "utf-8");
  const allSources = scannedFiles.map((path) => ({ path, source: readFileSync(path, "utf-8") }));

  it("no route/gate/component renders a bare loading-text paragraph -- every loading state goes through the shared LoadingState (role=status)", () => {
    const offenders = allSources.filter(({ path, source }) => !path.split(sep).join("/").endsWith("design/LoadingState.tsx") && source.includes('className="loading-text"')).map(({ path }) => path);
    expect(offenders).toEqual([]);
    const loading = src("design/LoadingState.tsx");
    expect(loading).toContain('role="status"');
    expect(loading).toContain('aria-live="polite"');
  });

  it("ErrorNotice announces itself (role=alert) and FailureScreen never renders an error object, message, stack, or JSON", () => {
    expect(src("design/ErrorNotice.tsx")).toContain('role="alert"');
    const failure = src("components/FailureScreen.tsx");
    expect(failure).toContain('role="alert"');
    expect(failure.toLowerCase()).not.toMatch(/stack|json\.stringify|error\.message|\.failure\b/);
  });

  it("every practice/dashboard route's catch reads only isSessionExpiredError() -- never the error's message -- and renders FailureScreen", () => {
    for (const file of ["DashboardRoute.tsx", "PracticeNextRoute.tsx", "PracticeQuestionRoute.tsx", "PracticeAutopsyRoute.tsx"]) {
      const source = src(`routes/${file}`);
      expect(source, file).toContain("isSessionExpiredError");
      expect(source, file).toContain("FailureScreen");
      expect(source.toLowerCase(), file).not.toMatch(/error\.message|json\.stringify|\.stack/);
    }
  });

  it("the autopsy route's load failure is retryable, not a dead end", () => {
    const source = src("routes/PracticeAutopsyRoute.tsx");
    expect(source).toContain("retryCount");
    expect(source).toContain("onRetry");
  });

  it("answer submission and autopsy responses cannot be duplicated: routes guard on their in-flight flag and the controls are disabled meanwhile", () => {
    expect(src("routes/PracticeQuestionRoute.tsx")).toMatch(/if \(submitting\) return/);
    expect(src("components/QuestionPlayer.tsx")).toMatch(/disabled=\{submitting\}/);
    expect(src("components/QuestionPlayer.tsx")).toMatch(/disabled=\{!selected \|\| submitting\}/);
    expect(src("routes/PracticeAutopsyRoute.tsx")).toMatch(/responding\) return/);
    expect(src("components/ConfirmationPrompt.tsx")).toMatch(/disabled=\{disabled\}/);
  });

  it("the question screen has a real h1, exposes the selected option (aria-pressed), and the result/solution controls are labelled", () => {
    const player = src("components/QuestionPlayer.tsx");
    expect(player).toContain("<h1");
    expect(player).toContain("aria-pressed");
    const result = src("components/ResultScreen.tsx");
    expect(result).toContain("<h1");
    expect(result).toContain("aria-expanded");
    expect(result).toContain('aria-hidden="true"'); // the decorative check/cross glyph
  });

  it("ResultScreen offers 'View solution' only when there are solution steps (the real adapter returns none today)", () => {
    expect(src("components/ResultScreen.tsx")).toMatch(/solutionSteps\.length > 0/);
  });

  it("AutopsyCard never leaves the student without a next action (no-hypothesis and nothing-to-review both offer Continue)", () => {
    const source = src("components/AutopsyCard.tsx");
    expect(source).toContain("onContinue");
    expect(source).toContain("There's nothing to review for this attempt.");
  });

  it("the shell exposes a skip link, a focusable main landmark, and moves focus/title on route change", () => {
    const app = src("App.tsx");
    expect(app).toContain('className="skip-link"');
    expect(app).toContain('href="#main-content"');
    expect(app).toContain('id="main-content"');
    expect(app).toContain("useRouteAccessibility");
    expect(src("router/RouteAccessibility.ts")).toContain("document.title");
  });

  it("signup inputs are wired to their validation messages (aria-invalid + aria-describedby) and a failed submit moves focus to the first invalid field", () => {
    const source = src("routes/SignupPage.tsx");
    expect(source).toContain("aria-invalid");
    expect(source).toContain("aria-describedby");
    expect(source).toContain("firstInvalidFieldId");
  });

  it("auth/enrollment state applied before a post-success navigate() is flushed synchronously (regression: signup bounced to /login)", () => {
    for (const file of ["auth/AuthContext.tsx", "enrollment/EnrollmentContext.tsx"]) {
      expect(src(file), file).toContain("flushSync");
    }
    // ...and the two actions that navigate right after must actually use it.
    expect(src("auth/AuthContext.tsx")).toMatch(/flushSync\(\(\) => dispatch\(\{ type: "SIGNED_UP"/);
    expect(src("auth/AuthContext.tsx")).toMatch(/flushSync\(\(\) => dispatch\(\{ type: "LOGGED_IN"/);
  });

  it("the stylesheet honors reduced motion, styles disabled buttons, and never lets the header email/long words force horizontal scroll", () => {
    const css = src("styles.css");
    expect(css).toContain("prefers-reduced-motion: reduce");
    expect(css).toContain(".btn:disabled");
    expect(css).toMatch(/\.auth-header-email \{[^}]*text-overflow: ellipsis/);
    expect(css).toMatch(/\.prompt-text \{[^}]*overflow-wrap/);
    expect(css).toMatch(/\.fact-row \{[^}]*flex-wrap: wrap/);
  });

  it("production runtime is unchanged: App.tsx still selects createApiTrainingAdapter() and no fixture adapter, no new fetch call sites were added", () => {
    expect(src("App.tsx")).toContain("createApiTrainingAdapter()");
    expect(src("App.tsx")).not.toMatch(/import\s*\{[^}]*createFixtureTrainingAdapter/);
    expect(src("App.tsx")).not.toMatch(/[=(]\s*createFixtureTrainingAdapter\(\)/); // an actual call, not the doc-comment mention
    // Every request still goes through http.ts's jsonRequest() (via auth/api.ts, enrollment/api.ts, the API adapter) -- no scanned file calls fetch() itself.
    const fetchCallers = allSources.filter(({ source }) => /\bfetch\(/.test(source)).map(({ path }) => path);
    expect(fetchCallers).toEqual([]);
  });
});

describe("Final QA hardening (Product Phase 1 Unit 12)", () => {
  const src = (path: string) => readFileSync(join(webRoot, "src", path), "utf-8");

  it("a question with no options is answerable: QuestionPlayer renders a labelled typed-answer input, and grading stays server-side (no answer comparison in the component)", () => {
    const player = src("components/QuestionPlayer.tsx");
    expect(player).toContain('htmlFor="numeric-answer"');
    expect(player).toContain('id="numeric-answer"');
    expect(player).toMatch(/inputMode="decimal"/);
    expect(player).toMatch(/hasOptions/);
    expect(player).not.toMatch(/correctAnswer|isCorrect/);
  });

  it("Log in / Sign up send an already-signed-in student on to /dashboard, without racing their own submit navigation", () => {
    const hook = src("auth/useRedirectIfSignedIn.ts");
    expect(hook).toContain('navigate("/dashboard")');
    expect(hook).toMatch(/!submittedRef\.current/);
    for (const page of ["routes/LoginPage.tsx", "routes/SignupPage.tsx"]) {
      const source = src(page);
      expect(source).toContain("useRedirectIfSignedIn()");
      expect(source).toMatch(/markSubmitted\(\);/);
    }
  });
});
