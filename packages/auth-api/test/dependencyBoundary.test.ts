import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));

/** The auth application/API boundary must coordinate `@ipmat/auth`/`@ipmat/db` only — never Prisma directly, never any domain-decision engine, never a UI/AI/HTTP-framework package (mirrors `@ipmat/practice-api`'s own dependency-boundary test). */
describe("auth-api -- dependency boundary", () => {
  it("package.json declares exactly the approved dependency set", () => {
    const pkg = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf-8")) as { dependencies?: Record<string, string> };
    expect(Object.keys(pkg.dependencies ?? {}).sort()).toEqual(["@ipmat/auth", "@ipmat/db"].sort());
  });

  it("no source file imports Prisma, a domain-decision engine, an AI SDK, apps/web, or node:http", () => {
    const forbidden = [
      "@prisma/client",
      "@ipmat/attempt",
      "@ipmat/autopsy",
      "@ipmat/mastery",
      "@ipmat/training-orchestration",
      "@ipmat/adaptive-selection",
      "@ipmat/repair-selection",
      "@ipmat/training-systems",
      "@ipmat/practice-loop",
      "@ipmat/training-recommendation",
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
