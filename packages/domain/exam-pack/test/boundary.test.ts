import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
const genericFiles = readdirSync(SRC).filter((f) => f.endsWith(".ts"));
const read = (file: string): string => readFileSync(join(SRC, file), "utf-8");

describe("exam-pack boundaries (D-082)", () => {
  it("finds the generic modules", () => {
    expect(genericFiles).toEqual(expect.arrayContaining(["types.ts", "validate.ts", "traversal.ts", "service.ts", "semantics.ts"]));
  });

  it("generic modules never name a specific exam or import exam-specific data", () => {
    for (const file of genericFiles) {
      const code = read(file);
      if (file !== "index.ts") {
        expect(code, file).not.toMatch(/IPMAT/);
        expect(code, file).not.toMatch(/from\s+["']\.\/packs\//);
      }
    }
  });

  it("imports only @ipmat/concept-graph from outside the package - no Prisma, db, AI, mastery, attempt or web", () => {
    const imports = new Set<string>();
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) walk(join(dir, entry.name));
        else if (entry.name.endsWith(".ts")) {
          for (const m of readFileSync(join(dir, entry.name), "utf-8").matchAll(/from\s+["']([^."'][^"']*)["']/g)) imports.add(m[1]!);
        }
      }
    };
    walk(SRC);
    expect([...imports]).toEqual(["@ipmat/concept-graph"]);
  });

  it("has no student-state field: no mastery, confidence, attempt or student vocabulary in the generic types", () => {
    const types = read("types.ts").replace(/\/\*[\s\S]*?\*\//g, "");
    for (const forbidden of ["mastery", "confidence", "attemptId", "studentId", "score"]) expect(types.toLowerCase()).not.toContain(forbidden.toLowerCase());
  });
});
