import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));

/**
 * Guards the package-architecture constraints from docs/DECISIONS.md D-058:
 * Novelty Training must depend only on `@ipmat/training-systems` (the
 * shared contract) and `@ipmat/mastery` (the reused evidence-sufficiency
 * constant), and must never depend on, or import a single source line
 * from, any sibling provider, `@ipmat/adaptive-selection`,
 * `@ipmat/repair-selection`, `@ipmat/training-orchestration`,
 * `@prisma/client`, `@ipmat/db`, or any AI/Anthropic/OpenAI SDK -- it is
 * a peer provider, not their coordinator.
 */
describe("novelty-training -- dependency/domain boundary", () => {
  it("package.json declares exactly the approved dependency set", () => {
    const pkg = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf-8")) as { dependencies?: Record<string, string> };
    expect(Object.keys(pkg.dependencies ?? {}).sort()).toEqual(["@ipmat/mastery", "@ipmat/training-systems"]);
  });

  it("no source file has an import/require statement for any sibling provider, adaptive-selection, repair-selection, training-orchestration, @prisma/client, @ipmat/db, or an AI SDK", () => {
    const forbidden = [
      "@ipmat/calculation-gym",
      "@ipmat/speed-lab",
      "@ipmat/trap-lab",
      "@ipmat/adaptive-selection",
      "@ipmat/repair-selection",
      "@ipmat/training-orchestration",
      "@prisma/client",
      "@ipmat/db",
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
