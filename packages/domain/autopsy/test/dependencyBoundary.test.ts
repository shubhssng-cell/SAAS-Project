import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));

/**
 * Guards docs/DECISIONS.md D-039's addendum (RepairPlan/Autopsy
 * persistence-fidelity fix) — `fromRepairPlanPersistenceRecord()` takes
 * only plain, already-resolved primitive data (never a Prisma row, never
 * a Prisma-generated type), exactly like `toRepairPlanPersistenceRecord()`
 * already does. This test proves `@ipmat/autopsy` stays completely free
 * of `@prisma/client`/`@ipmat/db` imports even after that addition.
 */
describe("@ipmat/autopsy -- dependency/domain boundary (D-039 addendum)", () => {
  it("no source file imports @prisma/client or @ipmat/db", () => {
    const forbidden = ["@prisma/client", "@ipmat/db"];
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
