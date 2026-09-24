import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));

/**
 * Guards docs/project-memory/37_TRAINING_RECOMMENDATION.md §2/§18's
 * approved dependency set. `@ipmat/autopsy` is included because
 * `fromRepairPlanPersistenceRecord()` (§5 step 13, §14) lives there and is
 * re-exported by nothing else. This layer reaches repair selection,
 * adaptive selection, the shared training-system contract, and every
 * concrete provider ONLY transitively, through `@ipmat/training-orchestration`.
 */
describe("training-recommendation -- dependency boundary", () => {
  it("package.json declares exactly the approved dependency set", () => {
    const pkg = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf-8")) as { dependencies?: Record<string, string> };
    expect(Object.keys(pkg.dependencies ?? {}).sort()).toEqual(
      [
        "@ipmat/attempt",
        "@ipmat/autopsy",
        "@ipmat/db",
        "@ipmat/mastery",
        "@ipmat/practice-block",
        "@ipmat/practice-session",
        "@ipmat/question-engine",
        "@ipmat/training-orchestration"
      ].sort()
    );
  });

  it("no source file imports Prisma, a selection engine, a training-system provider, an AI SDK, or any API/UI package", () => {
    const forbidden = [
      "@prisma/client",
      "@ipmat/repair-selection",
      "@ipmat/adaptive-selection",
      "@ipmat/training-systems",
      "@ipmat/calculation-gym",
      "@ipmat/speed-lab",
      "@ipmat/trap-lab",
      "@ipmat/novelty-training",
      "@ipmat/pressure-training",
      "@ipmat/prep-phase",
      "@ipmat/practice-loop",
      "@ipmat/ai",
      "@ipmat/web",
      "@ipmat/training-playground",
      "@anthropic-ai/sdk",
      "openai",
      "react",
      "next"
    ];
    const importSpecifierPattern = /(?:from\s+|import\(|require\()["']([^"']+)["']/g;
    const srcDir = join(packageRoot, "src");
    const files = readdirSync(srcDir).filter((f) => f.endsWith(".ts"));
    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const contents = readFileSync(join(srcDir, file), "utf-8");
      const specifiers = [...contents.matchAll(importSpecifierPattern)].map((m) => m[1] ?? "");
      for (const pkg of forbidden) {
        expect(specifiers.some((s) => s === pkg || s.startsWith(`${pkg}/`)), `${file} must not import "${pkg}"`).toBe(false);
      }
    }
  });

  it("@ipmat/db still does not depend on training-orchestration, training-systems, or any provider", () => {
    const dbPkg = JSON.parse(readFileSync(join(packageRoot, "..", "db", "package.json"), "utf-8")) as { dependencies?: Record<string, string> };
    const deps = Object.keys(dbPkg.dependencies ?? {});
    for (const pkg of [
      "@ipmat/training-orchestration",
      "@ipmat/training-systems",
      "@ipmat/training-recommendation",
      "@ipmat/calculation-gym",
      "@ipmat/speed-lab",
      "@ipmat/trap-lab",
      "@ipmat/novelty-training",
      "@ipmat/pressure-training"
    ]) {
      expect(deps).not.toContain(pkg);
    }
  });
});
