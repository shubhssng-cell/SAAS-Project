import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));

/**
 * The application/API boundary must coordinate `@ipmat/training-recommendation`
 * and `@ipmat/practice-loop` only — never a selection engine, never a
 * concrete training-system provider, never Prisma directly, never any
 * UI/AI package (K).
 */
describe("practice-api -- dependency boundary", () => {
  it("package.json declares exactly the approved dependency set", () => {
    const pkg = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf-8")) as { dependencies?: Record<string, string> };
    expect(Object.keys(pkg.dependencies ?? {}).sort()).toEqual(
      ["@ipmat/attempt", "@ipmat/db", "@ipmat/practice-loop", "@ipmat/training-orchestration", "@ipmat/training-recommendation", "@ipmat/training-session"].sort()
    );
  });

  it("no source file imports Prisma, a selection engine, a training-system provider, an AI SDK, or apps/web", () => {
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
      "@ipmat/mastery",
      "@ipmat/web",
      "@ipmat/ai",
      "@anthropic-ai/sdk",
      "openai",
      "react",
      "next",
      "node:http",
      "http"
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
});
