import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));

/**
 * Guards docs/DECISIONS.md D-062's approved dependency set for
 * `@ipmat/training-orchestration` — the FIRST time this package has ever
 * depended on `@ipmat/training-systems` or a concrete provider (D-053's
 * own doc comment anticipated exactly this future dependency direction).
 * Unlike the providers themselves (which must depend on NEITHER each
 * other NOR training-orchestration — see each provider's own
 * `dependencyBoundary.test.ts`), this package is the coordinator and is
 * EXPECTED to depend on all five, plus the shared contract. What it must
 * still never depend on: `@prisma/client`, `@ipmat/db`, `@ipmat/attempt`,
 * `@ipmat/practice-block`/`@ipmat/practice-session` directly (block/session
 * evidence only ever arrives already-restated, via `TrainingOrchestrationInput.
 * practiceBlocks`, never by importing those packages), any UI/API package,
 * or any AI SDK.
 */
describe("training-orchestration -- dependency/domain boundary (D-062)", () => {
  it("package.json declares exactly the approved dependency set", () => {
    const pkg = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf-8")) as { dependencies?: Record<string, string> };
    expect(Object.keys(pkg.dependencies ?? {}).sort()).toEqual(
      [
        "@ipmat/adaptive-selection",
        "@ipmat/autopsy",
        "@ipmat/calculation-gym",
        "@ipmat/mastery",
        "@ipmat/novelty-training",
        "@ipmat/prep-phase",
        "@ipmat/pressure-training",
        "@ipmat/question-engine",
        "@ipmat/repair-selection",
        "@ipmat/speed-lab",
        "@ipmat/trap-lab",
        "@ipmat/training-systems"
      ].sort()
    );
  });

  it("no source file imports @prisma/client, @ipmat/db, @ipmat/attempt, @ipmat/practice-block, @ipmat/practice-session, or an AI SDK", () => {
    const forbidden = ["@prisma/client", "@ipmat/db", "@ipmat/attempt", "@ipmat/practice-block", "@ipmat/practice-session", "@anthropic-ai/sdk", "openai"];
    const importSpecifierPattern = /(?:from\s+|require\()["']([^"']+)["']/g;
    const srcDir = join(packageRoot, "src");
    const files = readdirSync(srcDir).filter((f) => f.endsWith(".ts"));
    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const contents = readFileSync(join(srcDir, file), "utf-8");
      const specifiers = [...contents.matchAll(importSpecifierPattern)].map((m) => m[1]);
      for (const pkg of forbidden) {
        expect(specifiers.includes(pkg), `${file} must not import "${pkg}"`).toBe(false);
      }
    }
  });

  it("no provider package's OWN source was modified as part of D-062 -- each still declares its own pre-D-062, unchanged dependency set", () => {
    const providerDependencySets: Record<string, string[]> = {
      "trap-lab": ["@ipmat/autopsy", "@ipmat/training-systems"],
      "calculation-gym": ["@ipmat/mastery", "@ipmat/training-systems"],
      "speed-lab": ["@ipmat/autopsy", "@ipmat/mastery", "@ipmat/training-systems"],
      "novelty-training": ["@ipmat/mastery", "@ipmat/training-systems"],
      "pressure-training": ["@ipmat/mastery", "@ipmat/training-systems"]
    };
    for (const [dir, expectedDeps] of Object.entries(providerDependencySets)) {
      const pkgPath = join(packageRoot, "..", dir, "package.json");
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { dependencies?: Record<string, string> };
      expect(Object.keys(pkg.dependencies ?? {}).sort(), `${dir}'s dependency set must be unchanged by D-062`).toEqual([...expectedDeps].sort());
    }
  });
});
