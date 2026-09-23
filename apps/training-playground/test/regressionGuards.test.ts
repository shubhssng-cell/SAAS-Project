import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const appRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const srcDir = join(appRoot, "src");

function allSourceFiles(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...allSourceFiles(full));
    else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) files.push(full);
  }
  return files;
}

/**
 * Regression guards (docs/DECISIONS.md D-057): this internal playground
 * must never introduce fake intelligence, must never reach past the real
 * domain packages' public exports, and must never quietly gain a
 * dependency this design brief explicitly forbade.
 */
describe("training-playground -- regression guards", () => {
  it("package.json has no Prisma, no Anthropic/AI-provider SDK, and no unexplained dependency", () => {
    const pkg = JSON.parse(readFileSync(join(appRoot, "package.json"), "utf-8")) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
    const forbiddenSubstrings = ["prisma", "anthropic", "openai"];
    for (const depName of Object.keys(allDeps)) {
      for (const forbidden of forbiddenSubstrings) {
        expect(depName.toLowerCase().includes(forbidden), `dependency "${depName}" must not reference "${forbidden}"`).toBe(false);
      }
    }
  });

  it("no source file has an import/require statement for @prisma/client, @ipmat/db, or any Anthropic SDK", () => {
    const forbidden = ["@prisma/client", "@ipmat/db", "@anthropic-ai/sdk"];
    const importSpecifierPattern = /(?:from\s+|require\()["']([^"']+)["']/g;
    const files = allSourceFiles(srcDir);
    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const contents = readFileSync(file, "utf-8");
      const specifiers = [...contents.matchAll(importSpecifierPattern)].map((m) => m[1]);
      for (const pkg of forbidden) {
        expect(specifiers.includes(pkg), `${file} must not import "${pkg}"`).toBe(false);
      }
    }
  });

  it("no source file references a confidence/motivation/emotion/predicted-ability/composite-score field name", () => {
    const forbiddenIdentifiers = [/confidence/i, /motivation/i, /predictedAbility/i, /\bemotion/i, /intelligenceScore/i, /compositeScore/i, /trapScore/i, /priorityScore/i, /overallMastery/i];
    const files = allSourceFiles(srcDir);
    for (const file of files) {
      const contents = readFileSync(file, "utf-8");
      for (const pattern of forbiddenIdentifiers) {
        expect(pattern.test(contents), `${file} must not reference ${pattern}`).toBe(false);
      }
    }
  });

  it("the domain adapter (runScenario.ts) never redeclares a domain package's own named threshold constant -- proving no decision logic was duplicated in the UI layer", () => {
    const adapterSource = readFileSync(join(srcDir, "domain", "runScenario.ts"), "utf-8");
    const domainOwnedConstants = [
      "REPEATED_EVIDENCE_MIN_COUNT",
      "HIGH_COMPUTATIONAL_LOAD_THRESHOLD",
      "CALCULATION_FRICTION_ACCURACY_GAP",
      "STAGE_MASTERY_ACCURACY",
      "LOW_CONCEPTUAL_LOAD_THRESHOLD",
      "SLOW_FRACTION_THRESHOLD",
      "GOOD_PACE_SPEED_RATIO",
      "SLOW_SPEED_RATIO",
      "ACCURACY_WEAKNESS_THRESHOLD",
      "TRAINING_ORCHESTRATION_POLICY"
    ];
    for (const constantName of domainOwnedConstants) {
      expect(adapterSource.includes(constantName), `runScenario.ts must not redeclare/reference "${constantName}" -- that logic belongs to the domain package, not the playground adapter`).toBe(false);
    }
  });

  it("the domain adapter (runScenario.ts) calls each real public entry point exactly once, never wrapping it in additional branching logic beyond a plain dispatch", () => {
    const adapterSource = readFileSync(join(srcDir, "domain", "runScenario.ts"), "utf-8");
    expect((adapterSource.match(/runTrainingSystemProvider\(/g) ?? []).length).toBe(1);
    expect((adapterSource.match(/orchestrateNextTrainingAction\(/g) ?? []).length).toBe(1);
  });
});
