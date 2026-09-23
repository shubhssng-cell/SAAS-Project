import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));

/**
 * Guards docs/DECISIONS.md D-061's approved dependency set: EXACTLY
 * `@ipmat/training-systems` + `@ipmat/mastery` (for `MASTERY_CONSTANTS.
 * MIN_OBSERVATIONS_FOR_COMPONENT` reuse only). No sibling provider, no
 * `@ipmat/practice-block`/`@ipmat/practice-session`/`@ipmat/db`/
 * `@ipmat/attempt`/`@ipmat/adaptive-selection`/`@ipmat/repair-selection`/
 * `@ipmat/training-orchestration`, no Prisma, no AI SDK.
 */
describe("pressure-training -- dependency/domain boundary", () => {
  it("package.json declares exactly the approved dependency set", () => {
    const pkg = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf-8")) as { dependencies?: Record<string, string> };
    expect(Object.keys(pkg.dependencies ?? {}).sort()).toEqual(["@ipmat/mastery", "@ipmat/training-systems"]);
  });

  it("no source file has an import/require statement for any sibling provider, practice-session/block, db, attempt, orchestration/selection packages, Prisma, or an AI SDK", () => {
    const forbidden = [
      "@ipmat/calculation-gym",
      "@ipmat/speed-lab",
      "@ipmat/trap-lab",
      "@ipmat/novelty-training",
      "@ipmat/practice-block",
      "@ipmat/practice-session",
      "@ipmat/practice-loop",
      "@ipmat/db",
      "@ipmat/attempt",
      "@ipmat/adaptive-selection",
      "@ipmat/repair-selection",
      "@ipmat/training-orchestration",
      "@prisma/client",
      "@anthropic-ai/sdk",
      "openai"
    ];
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
});
