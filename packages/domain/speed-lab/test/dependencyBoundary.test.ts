import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));

/**
 * Guards the package-architecture constraints from docs/DECISIONS.md D-055:
 * Speed Lab must depend only on `@ipmat/training-systems` (the shared
 * contract), `@ipmat/mastery` (the reused evidence-sufficiency constant),
 * and `@ipmat/autopsy` (the reused canonical slow-speed threshold), and
 * must never depend on, or import a single source line from,
 * `@ipmat/calculation-gym`, `@ipmat/adaptive-selection`,
 * `@ipmat/repair-selection`, `@ipmat/training-orchestration`,
 * `@prisma/client`, or `@ipmat/db` -- it is a peer provider, not their
 * coordinator, and never recreates their matching/ranking logic.
 */
describe("speed-lab -- dependency/domain boundary", () => {
  it("package.json declares exactly the approved dependency set", () => {
    const pkg = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf-8")) as { dependencies?: Record<string, string> };
    expect(Object.keys(pkg.dependencies ?? {}).sort()).toEqual(["@ipmat/autopsy", "@ipmat/mastery", "@ipmat/training-systems"]);
  });

  it("no source file has an import/require statement for @ipmat/calculation-gym, @ipmat/adaptive-selection, @ipmat/repair-selection, @ipmat/training-orchestration, @prisma/client, or @ipmat/db", () => {
    // Matches actual import/require specifiers only (e.g. `from "@ipmat/x"` or `require("@ipmat/x")`) --
    // NOT prose in doc comments that explain, by name, why a sibling package is deliberately NOT depended on.
    const forbidden = ["@ipmat/calculation-gym", "@ipmat/adaptive-selection", "@ipmat/repair-selection", "@ipmat/training-orchestration", "@prisma/client", "@ipmat/db"];
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
