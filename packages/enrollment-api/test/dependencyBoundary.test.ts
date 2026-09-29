import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));

/** The enrollment application/API boundary must coordinate `@ipmat/db`/`@ipmat/prep-phase` only — never Prisma directly, never `@ipmat/auth`/`@ipmat/auth-api` (identity is already verified by the caller), never a UI/AI/HTTP-framework package. Mirrors `@ipmat/auth-api`'s own dependency-boundary test. */
describe("enrollment-api -- dependency boundary", () => {
  it("package.json declares exactly the approved dependency set", () => {
    const pkg = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf-8")) as { dependencies?: Record<string, string> };
    expect(Object.keys(pkg.dependencies ?? {}).sort()).toEqual(["@ipmat/db", "@ipmat/prep-phase"].sort());
  });

  it("no source file imports Prisma, @ipmat/auth, @ipmat/auth-api, an AI SDK, apps/web, or node:http", () => {
    const forbidden = ["@prisma/client", "@ipmat/auth", "@ipmat/auth-api", "@ipmat/web", "@ipmat/ai", "@anthropic-ai/sdk", "openai", "react", "next", "node:http", "http"];
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
