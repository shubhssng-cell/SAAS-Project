import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));

/**
 * Guards docs/DECISIONS.md D-075: `@ipmat/training-session` is a pure domain package. It
 * routes a system id to an EXISTING provider; it never imports a persistence client, an AI
 * provider, or either selection engine -- so it cannot grow a second selection/mastery
 * engine -- and it never imports a concrete provider package directly (the existing
 * orchestration registry is the one place providers are registered).
 */
describe("training-session -- dependency boundary and no duplicate engines", () => {
  it("package.json declares exactly the approved dependency set", () => {
    const pkg = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf-8")) as { dependencies?: Record<string, string> };
    expect(Object.keys(pkg.dependencies ?? {}).sort()).toEqual(["@ipmat/attempt", "@ipmat/practice-block", "@ipmat/training-orchestration", "@ipmat/training-systems"]);
  });

  it("no source file imports a persistence client, an AI package, a selection engine, mastery, or a concrete provider", () => {
    const forbidden = [
      "@prisma/client",
      "@ipmat/db",
      "@ipmat/ai",
      "@ipmat/adaptive-selection",
      "@ipmat/repair-selection",
      "@ipmat/mastery",
      "@ipmat/calculation-gym",
      "@ipmat/speed-lab",
      "@ipmat/trap-lab",
      "@ipmat/novelty-training",
      "@ipmat/pressure-training"
    ];
    const importSpecifierPattern = /(?:from\s+|require\()["']([^"']+)["']/g;
    const srcDir = join(packageRoot, "src");
    const files = readdirSync(srcDir).filter((f) => f.endsWith(".ts"));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const specifiers = [...readFileSync(join(srcDir, file), "utf-8").matchAll(importSpecifierPattern)].map((m) => m[1]);
      for (const pkg of forbidden) expect(specifiers.includes(pkg), `${file} must not import "${pkg}"`).toBe(false);
    }
  });

  it("contains no ranking/scoring/sorting of candidates or any confidence/emotion field", () => {
    const srcDir = join(packageRoot, "src");
    for (const file of readdirSync(srcDir).filter((f) => f.endsWith(".ts"))) {
      const code = readFileSync(join(srcDir, file), "utf-8")
        .split("\n")
        .filter((line) => !line.trim().startsWith("*") && !line.trim().startsWith("//") && !line.trim().startsWith("/*"))
        .join("\n");
      expect(code, `${file} must not sort`).not.toMatch(/\.sort\(/);
      expect(code.toLowerCase(), `${file}`).not.toMatch(/confidence|emotion|motivation|anxiety/);
    }
  });
});
