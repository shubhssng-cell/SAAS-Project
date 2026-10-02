import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
const files = readdirSync(SRC).filter((f) => f.endsWith(".ts"));
const read = (f: string): string => readFileSync(join(SRC, f), "utf-8");
const stripComments = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const types = stripComments(read("types.ts"));

describe("examiner-intelligence boundaries (D-083)", () => {
  it("imports only exam-pack, concept-graph, examiner-lens and question-engine - no Prisma, db, AI provider, mastery, attempt or web", () => {
    const imports = new Set<string>();
    for (const f of files) for (const m of read(f).matchAll(/from\s+["']([^."'][^"']*)["']/g)) imports.add(m[1]!);
    expect([...imports].sort()).toEqual(["@ipmat/concept-graph", "@ipmat/exam-pack", "@ipmat/examiner-lens", "@ipmat/question-engine"]);
  });

  it("a record has NO question content: no body, options, answer key, solution or explanation field (copyrighted text is never stored)", () => {
    for (const forbidden of ["body", "options", "correctAnswer", "solutionSteps", "groundTruth", "explanation", "stem"]) expect(types, forbidden).not.toMatch(new RegExp(`\\b${forbidden}\\b`));
  });

  it("no type can carry a prediction, likelihood or importance forecast: historical evidence is observed testing evidence, not a prediction", () => {
    for (const forbidden of ["predict", "likelihood", "probability", "likely", "forecast", "expectedToAppear", "willAppear", "importanceScore", "priority"]) expect(types.toLowerCase(), forbidden).not.toContain(forbidden.toLowerCase());
    for (const f of ["queries.ts", "service.ts"]) {
      const code = stripComments(read(f)).toLowerCase();
      for (const forbidden of ["predict", "likelihood", "forecast", "willappear"]) expect(code, `${f}:${forbidden}`).not.toContain(forbidden);
    }
  });

  it("no student-state field (mastery, confidence, attempts, students)", () => {
    for (const forbidden of ["mastery", "confidence", "attemptId", "studentId", "accuracy"]) expect(types.toLowerCase(), forbidden).not.toContain(forbidden.toLowerCase());
  });

  it("introduces no new difficulty or novelty vocabulary: it restates the existing six dimensions and four novelty levels only", () => {
    const validate = read("validate.ts");
    expect(validate).toContain('"conceptualLoad", "computationalLoad", "trapDensity", "representationNovelty", "timePressure", "multiStepDepth"');
    expect(validate).toContain("standard: true, novel_representation: true, novel_combination: true, novel_context: true");
  });

  it("reuses the existing DNA type rather than defining a parallel one", () => {
    expect(types).toMatch(/Omit<QuestionDnaData,/);
  });
});
