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

const SCANNED_DIRS = ["src/router", "src/routes", "src/design", "src/components"];
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
