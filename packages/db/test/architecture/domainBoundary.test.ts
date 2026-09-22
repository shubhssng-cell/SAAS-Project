import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Enforces docs/ARCHITECTURE.md §6: "`/packages/domain/*` modules depend
 * only on plain TS + other `/packages/domain/*` packages... never on
 * `/packages/db`'s Prisma client or types directly." Phase 5C-1 is the
 * FIRST phase to build a real Prisma-backed persistence adapter
 * (`packages/db/src/repositories`), which makes this the first point
 * where a domain package could plausibly be tempted to reach for Prisma
 * directly — this test makes the boundary a real, automated check instead
 * of a convention nobody verifies.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const DOMAIN_ROOT = join(__dirname, "..", "..", "..", "domain");
const FORBIDDEN_IMPORT_PATTERN = /from\s+["'](@prisma\/client|@ipmat\/db)(\/|["'])/;
const FORBIDDEN_DEPENDENCIES = ["@prisma/client", "@ipmat/db"];

function listDomainPackageDirs(): string[] {
  return readdirSync(DOMAIN_ROOT).filter((name) => statSync(join(DOMAIN_ROOT, name)).isDirectory());
}

function listSourceFiles(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      files.push(...listSourceFiles(full));
    } else if (entry.name.endsWith(".ts")) {
      files.push(full);
    }
  }
  return files;
}

const packages = listDomainPackageDirs();

describe("domain package boundary — no packages/domain/* package imports Prisma or @ipmat/db directly (docs/ARCHITECTURE.md §6)", () => {
  it("finds at least one domain package to check", () => {
    expect(packages.length).toBeGreaterThan(0);
  });

  it.each(packages)("package.json for %s declares no dependency on @prisma/client or @ipmat/db", (pkgName) => {
    const pkgJsonPath = join(DOMAIN_ROOT, pkgName, "package.json");
    const pkgJson = JSON.parse(readFileSync(pkgJsonPath, "utf-8")) as { dependencies?: Record<string, string> };
    const deps = Object.keys(pkgJson.dependencies ?? {});
    for (const forbidden of FORBIDDEN_DEPENDENCIES) {
      expect(deps).not.toContain(forbidden);
    }
  });

  it.each(packages)("source files under %s never import from @prisma/client or @ipmat/db", (pkgName) => {
    const srcDir = join(DOMAIN_ROOT, pkgName, "src");
    let files: string[];
    try {
      files = listSourceFiles(srcDir);
    } catch {
      files = [];
    }
    const offenders: string[] = [];
    for (const file of files) {
      const content = readFileSync(file, "utf-8");
      if (FORBIDDEN_IMPORT_PATTERN.test(content)) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });
});
