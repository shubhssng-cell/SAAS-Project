import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
const files = readdirSync(SRC).filter((f) => f.endsWith(".ts"));
const read = (f: string): string => readFileSync(join(SRC, f), "utf-8");
const strip = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const code = files.map((f) => strip(read(f))).join("\n");

describe("exam-intelligence boundaries (D-086)", () => {
  it("imports only the exam/content/historical vocabulary - no Prisma, db, AI, training provider, mastery, attempt or web", () => {
    const imports = new Set<string>();
    for (const f of files) for (const m of read(f).matchAll(/from\s+["']([^."'][^"']*)["']/g)) imports.add(m[1]!);
    expect([...imports].sort()).toEqual(["@ipmat/concept-graph", "@ipmat/content-authoring", "@ipmat/exam-pack", "@ipmat/examiner-intelligence", "@ipmat/examiner-lens", "@ipmat/question-engine"]);
  });
  it("does NOT read student state and infers no mastery, confidence or mental state", () => {
    const lower = code.toLowerCase();
    for (const forbidden of ["mastery", "confidence", "studentid", "attemptid", "motivation", "anxiety", "emotion", "intelligence score", "readiness"]) expect(lower, forbidden).not.toContain(forbidden);
    expect(lower.split(/[^a-z]+/)).not.toContain("ability"); // whole word only: "calibratable" is not a claim about a student
  });
  it("makes no prediction: no likelihood, probability, forecast or future-paper vocabulary", () => {
    const lower = code.toLowerCase();
    for (const forbidden of ["predict", "likelihood", "forecast", "will appear", "next exam", "expected to appear", "importancescore", "probability"]) expect(lower, forbidden).not.toContain(forbidden);
  });
  it("has no single overall coverage number or blended difficulty score", () => {
    for (const forbidden of ["overallCoverage", "coverageScore", "totalCoverage", "coveragePercent", "difficultyScore", "compositeScore"]) expect(code, forbidden).not.toContain(forbidden);
  });
  it("never produces `calibrated` by itself: the only way is an explicit, sufficient record", () => {
    const cal = strip(read("calibration.ts"));
    const assignments = cal.match(/status: "calibrated"/g) ?? [];
    expect(assignments).toHaveLength(1); // the single branch guarded by a valid record
    expect(cal).toMatch(/if \(problems\.length === 0\) return \{ status: "calibrated"/);
  });
  it("reads no clock and no network, names no vendor", () => {
    expect(code).not.toMatch(/Date\.now\(|new Date\(\)|fetch\(|https?:\/\//);
    for (const forbidden of ["anthropic", "openai", "gemini", "claude"]) expect(code.toLowerCase()).not.toContain(forbidden);
  });
  it("owns no provider logic: it imports no training provider and exposes no ranking or recommendation", () => {
    for (const forbidden of ["rank", "recommend", "nextQuestion", "priorityScore", "selectNext"]) expect(code, forbidden).not.toContain(forbidden);
  });
  it("selection results carry DNA-level facts only (types have no content/answer/reviewer/reference fields)", () => {
    const sel = strip(read("selection.ts"));
    const candidate = sel.slice(sel.indexOf("interface SelectionCandidate"), sel.indexOf("interface SelectionTraceStep"));
    for (const forbidden of ["body", "options", "correctAnswer", "solution", "explanation", "reviewedBy", "sourceRef", "licenseRef", "fingerprint"]) expect(candidate, forbidden).not.toContain(forbidden);
  });
  it("reuses the existing vocabularies and thresholds: no second DNA, taxonomy, or threshold set", () => {
    expect(code).toContain("UNIVERSE_THRESHOLDS");
    expect(code).toContain("TIME_DEMAND_BANDS");
    expect(code).toContain("validateDnaClassification");
    expect(code).toContain("structuralSignature");
  });
});
