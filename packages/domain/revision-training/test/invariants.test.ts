import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runTrainingSystemProvider } from "@ipmat/training-systems";
import type { MasteryAttemptRecord, TrainingCandidateQuestion } from "@ipmat/training-systems";
import { describe, expect, it } from "vitest";
import { evaluateRevision } from "../src/applicability.js";
import { DORMANCY_MS } from "../src/constants.js";
import { RevisionTrainingProvider } from "../src/provider.js";
import type { RevisionTrainingRequirement } from "../src/types.js";
import { MS_PER_DAY, NOW, daysAgo, makeAttemptRecord, makeCandidate, makeContext } from "./fixtures.js";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const provider = new RevisionTrainingProvider();

function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}
function shuffled<T>(items: T[], next: () => number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}
const CONCEPTS = ["Averages", "Percentages", "Ratio", "Profit", "Mixtures"];
function randomHistory(next: () => number): MasteryAttemptRecord[] {
  const records: MasteryAttemptRecord[] = [];
  for (const conceptName of CONCEPTS) {
    const count = Math.floor(next() * 6);
    for (let i = 0; i < count; i += 1) {
      const status = next() < 0.15 ? "skipped" : "submitted";
      records.push(makeAttemptRecord({ conceptName, status, isCorrect: next() < 0.5, finalizedAt: daysAgo(Math.floor(next() * 40) + next()), cell: `cell-${Math.floor(next() * 4)}` }));
    }
  }
  return records;
}

describe("Revision -- property tests (seeded, no Math.random)", () => {
  it("over 200 random histories: the target is always an eligible concept, is the oldest-dormant one, and is independent of record order", () => {
    for (let seed = 1; seed <= 200; seed += 1) {
      const next = lcg(seed);
      const records = randomHistory(next);
      const result = evaluateRevision(makeContext({ attemptRecords: records }));
      const reordered = evaluateRevision(makeContext({ attemptRecords: shuffled(records, next) }));
      expect(reordered, `seed ${seed}`).toEqual(result);

      // independent oracle
      const graded = records.filter((r) => r.contribution.status === "submitted" && r.contribution.isCorrect !== null);
      const eligible = CONCEPTS.map((name) => {
        const own = graded.filter((r) => r.question.conceptName === name);
        const last = Math.max(...own.map((r) => Date.parse(r.contribution.finalizedAt!)));
        return { name, count: own.length, last };
      })
        .filter((c) => c.count >= 3 && Date.parse(NOW) - c.last >= DORMANCY_MS)
        .sort((a, b) => a.last - b.last || a.name.localeCompare(b.name));

      if (eligible.length === 0) {
        expect(result.applicable, `seed ${seed}`).toBe(false);
      } else {
        expect(result.applicable, `seed ${seed}`).toBe(true);
        if (result.applicable) expect((result.requirement as RevisionTrainingRequirement).targetConceptName, `seed ${seed}`).toBe(eligible[0]!.name);
      }
    }
  });

  it("over 100 random pools: the served question is order-independent, published, of the target concept, and never another concept's", () => {
    for (let seed = 1; seed <= 100; seed += 1) {
      const next = lcg(seed * 7919);
      const history = [0, 1, 2].map((i) => makeAttemptRecord({ conceptName: "Percentages", finalizedAt: daysAgo(20 + i), cell: `cell-${i}` }));
      const pool: TrainingCandidateQuestion[] = Array.from({ length: 12 }, (_, i) =>
        makeCandidate(
          { questionId: `q-${String(i).padStart(2, "0")}`, conceptName: next() < 0.7 ? "Percentages" : "Ratio", patternTaxonomyCellId: `cell-${Math.floor(next() * 5)}` },
          { validationState: next() < 0.8 ? "published" : "ai_validated" }
        )
      );
      const a = runTrainingSystemProvider(provider, makeContext({ attemptRecords: history, candidates: pool }));
      const b = runTrainingSystemProvider(provider, makeContext({ attemptRecords: history, candidates: shuffled(pool, next) }));
      expect(b, `seed ${seed}`).toEqual(a);
      const published = pool.filter((c) => c.validationState === "published" && c.question.conceptName === "Percentages");
      if (published.length === 0) expect(a.status).toBe("no_eligible_question");
      else {
        expect(a.status).toBe("selected");
        if (a.status === "selected") expect(published.map((c) => c.question.questionId)).toContain(a.question.questionId);
      }
    }
  });

  it("monotone in time: once a concept is eligible it stays eligible as `now` moves forward with no new attempt", () => {
    const records = [0, 1, 2].map((i) => makeAttemptRecord({ finalizedAt: daysAgo(14 + i) }));
    for (let extraDays = 0; extraDays <= 60; extraDays += 3) {
      const now = new Date(Date.parse(NOW) + extraDays * MS_PER_DAY).toISOString();
      expect(evaluateRevision(makeContext({ attemptRecords: records, now })).applicable, `+${extraDays}d`).toBe(true);
    }
  });
});

describe("Revision -- architecture", () => {
  const sources = (): string => readdirSync(join(packageRoot, "src")).filter((f) => f.endsWith(".ts")).map((f) => readFileSync(join(packageRoot, "src", f), "utf-8")).join("\n");
  const codeOnly = (text: string): string => text.split("\n").filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l)).join("\n");

  it("no stage, score, decay, persisted state or randomness in the source", () => {
    const code = codeOnly(sources());
    expect(code).not.toMatch(/\bstage\b|stageKey|score|priorityScore|decay|spaced|probabilit|forgett|Math\.random|Date\.now|new Date\(\)|revisionDue|nextRevision|revisionState/i);
  });

  it("evaluate() never references candidates", () => {
    const applicability = codeOnly(readFileSync(join(packageRoot, "src", "applicability.ts"), "utf-8"));
    expect(applicability).not.toMatch(/candidates/);
  });

  it("declares exactly @ipmat/training-systems and imports no sibling provider, db, attempt, practice, selection, orchestration, Prisma or AI package", () => {
    const pkg = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf-8")) as { dependencies?: Record<string, string> };
    expect(Object.keys(pkg.dependencies ?? {})).toEqual(["@ipmat/training-systems"]);
    const forbidden = ["@ipmat/calculation-gym", "@ipmat/speed-lab", "@ipmat/trap-lab", "@ipmat/novelty-training", "@ipmat/pressure-training", "@ipmat/mastery", "@ipmat/autopsy", "@ipmat/practice-block", "@ipmat/practice-session", "@ipmat/db", "@ipmat/attempt", "@ipmat/adaptive-selection", "@ipmat/repair-selection", "@ipmat/training-orchestration", "@prisma/client", "@anthropic-ai/sdk", "openai"];
    const specifiers = [...sources().matchAll(/(?:from\s+|require\()["']([^"']+)["']/g)].map((m) => m[1]);
    for (const name of forbidden) expect(specifiers.includes(name), name).toBe(false);
  });

  it("every string the provider produces avoids confidence / ability / emotion / motivation / forgetting language", () => {
    const records = [0, 1, 2].map((i) => makeAttemptRecord({ finalizedAt: daysAgo(20 + i) }));
    const outcomes = [
      runTrainingSystemProvider(provider, makeContext({ attemptRecords: records, candidates: [makeCandidate({ patternTaxonomyCellId: "n" })] })),
      runTrainingSystemProvider(provider, makeContext({ attemptRecords: records })),
      runTrainingSystemProvider(provider, makeContext())
    ];
    const text = JSON.stringify(outcomes);
    expect(text).not.toMatch(/confiden|motivat|emotion|intelligen|\bability\b|anxi|stress|fatigu|forgot|forgett|weak|lazy|careless|psycholog|mastered|proven/i);
  });
});
