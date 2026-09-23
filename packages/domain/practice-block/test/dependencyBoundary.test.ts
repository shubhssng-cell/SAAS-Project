import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));

/** The PracticeBlock half of `@ipmat/practice-session`'s own dependencyBoundary.test.ts — see that file's doc comment for the full rationale (docs/DECISIONS.md D-060). */
describe("practice-block -- dependency/domain boundary", () => {
  it("package.json declares zero dependencies", () => {
    const pkg = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf-8")) as { dependencies?: Record<string, string> };
    expect(pkg.dependencies ?? {}).toEqual({});
  });

  it("no source file imports @ipmat/practice-session, @prisma/client, or @ipmat/db", () => {
    const forbidden = ["@ipmat/practice-session", "@prisma/client", "@ipmat/db"];
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
