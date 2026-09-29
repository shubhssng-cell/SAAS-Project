import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Enforces PHASE_1_PLATFORM_SHELL.md's "Web Architecture Lock" for every
 * file introduced or touched by Product Phase 1 Unit 2 -- the new
 * routing/shell layer must never import a domain package, a selection
 * engine, a training-system provider, `@ipmat/db`, or Prisma directly.
 *
 * The existing, already-documented exception (`src/adapter/service.ts`,
 * predating this lock, retired by Unit 10) is deliberately excluded from
 * this scan -- this test guards against NEW violations, it does not
 * re-litigate the tracked one.
 */

const SCANNED_DIRS = ["src/router", "src/routes", "src/design", "src/components", "src/auth", "src/enrollment", "src/dashboard"];
const EXCLUDED_FILES: string[] = [];

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
const scannedFiles = SCANNED_DIRS.flatMap((dir) => listSourceFiles(join(webRoot, dir))).filter((path) => !EXCLUDED_FILES.some((excluded) => path.endsWith(excluded)));

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

  it("DashboardRoute still calls the SAME unmodified fixture adapter for the practice recommendation (adapter.getDashboard, same onStart navigation target)", () => {
    const source = readFileSync(join(routesDir, "DashboardRoute.tsx"), "utf-8");
    expect(source).toContain("usePracticeSession");
    expect(source).toContain("adapter.getDashboard()");
    expect(source).toMatch(/navigate\(`\/practice\/\$\{dashboard\.recommendation\.questionId/);
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
