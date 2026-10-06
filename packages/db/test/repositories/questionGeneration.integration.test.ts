import { randomUUID } from "node:crypto";
import { percentagesConceptGraph } from "@ipmat/concept-graph";
import { AuthoringError, ContentAuthoringService } from "@ipmat/content-authoring";
import { passingJudge, percentagesPatternFamilies, percentagesTaxonomyCells, validGeneratedCandidate, validReverification } from "@ipmat/question-engine";
import { InMemoryGenerationTraceSink, buildGenerationSpec, createQuestionGenerationService, type GenerationSpec } from "@ipmat/question-generation";
import type { AiCompletion, AiProvider } from "@ipmat/ai";
import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaClient } from "../../src/client.js";
import { PrismaExamPackRepository } from "../../src/repositories/prismaExamPackRepository.js";
import { PrismaQuestionAuthoringRepository } from "../../src/repositories/prismaQuestionAuthoringRepository.js";
import { PrismaQuestionContentReader } from "../../src/repositories/prismaQuestionContentReader.js";
import { PrismaTrainingQuestionReader } from "../../src/repositories/prismaTrainingQuestionReader.js";

/**
 * REAL DATABASE tests for AI question generation (Phase 8 Unit 3, D-094). SKIPPED unless
 * `IPMAT_TEST_DATABASE_URL` is set; refuses any database whose name does not contain "test".
 * Prerequisites: migrations applied and `prisma/seed.ts` run. The model is a deterministic
 * double (no network). Generation REUSES the existing authoring persistence: there is no
 * generation table and no migration. Every row written here is deleted afterwards.
 */
const DATABASE_URL = process.env.IPMAT_TEST_DATABASE_URL;
if (DATABASE_URL) {
  const dbName = new URL(DATABASE_URL).pathname.replace(/^\//, "");
  if (!/test/i.test(dbName)) throw new Error(`Refusing to run integration tests against database "${dbName}": IPMAT_TEST_DATABASE_URL must point at a database whose name contains "test".`);
}

const RUN = `u3-${randomUUID().slice(0, 8)}`;
const REASONING = `SENTINEL-REASONING-${RUN}`;

class Double implements AiProvider {
  readonly name = "scripted";
  readonly model = "fixture-deterministic-v1";
  constructor(private readonly script: string[]) {}
  async complete(): Promise<AiCompletion> {
    const next = this.script.shift();
    if (next === undefined) throw new Error("no behaviour left");
    return { rawText: next, usage: { inputTokens: 0, outputTokens: 0 }, latencyMs: 1 };
  }
}
const advancedCell = percentagesTaxonomyCells.find((c) => c.coverageStatus === "covered")!;
const hardCell = percentagesTaxonomyCells.find((c) => c.difficultyTier === "hard")!;
const specFor = (cell = advancedCell, suffix = RUN): GenerationSpec =>
  buildGenerationSpec(cell, percentagesPatternFamilies.find((f) => f.name === cell.patternFamilyName)!, { examCode: "IPMAT_INDORE", sectionName: "Quant", chapterName: "Percentages", answerFormat: "multiple_choice", idSuffix: suffix });
const stemFor = (n: string) => `${RUN} ${n}: a shop raised the price of a jacket by 25 percent, after which it became four times the price of a notebook costing 150 rupees; what was the jacket's price before the rise?`;
const script = (spec: GenerationSpec, stem: string) => [
  JSON.stringify({
    ...validGeneratedCandidate,
    blueprintId: spec.blueprint.id,
    stem,
    reasoning: REASONING,
    questionDna: { ...validGeneratedCandidate.questionDna, difficultyTier: spec.blueprint.difficultyTier, difficultyDimensions: spec.blueprint.difficultyDimensions, testingModes: spec.blueprint.testingModes, trapErrorTaxonomyCode: spec.blueprint.trapErrorTaxonomyCode, combinesWithConcepts: spec.blueprint.combinationConcepts, expectedTimeSeconds: spec.blueprint.expectedTimeSeconds }
  }),
  JSON.stringify(validReverification),
  JSON.stringify(passingJudge)
];

describe.skipIf(!DATABASE_URL)("AI question generation - real Postgres", () => {
  let prisma: PrismaClient;
  let repo: PrismaQuestionAuthoringRepository;
  let authoring: ContentAuthoringService;
  let errorCodes: string[];
  const created: string[] = [];
  const traces = new InMemoryGenerationTraceSink();

  const engine = (provider: AiProvider) =>
    createQuestionGenerationService({
      provider,
      authoring,
      questions: repo,
      packs: new PrismaExamPackRepository(prisma),
      patternFamiliesFor: (code) => (code === "IPMAT_INDORE" ? percentagesPatternFamilies : []),
      errorTaxonomyCodes: errorCodes,
      graphFor: () => percentagesConceptGraph,
      traces,
      now: () => new Date("2026-10-06T10:00:00.000Z"),
      limits: { maxBlueprints: 1, maxCandidatesPerBlueprint: 1, maxRetries: 0, maxGenerationAttempts: 1, maxEstimatedBudgetUsd: 1 }
    });

  beforeAll(async () => {
    prisma = createPrismaClient(DATABASE_URL!);
    await prisma.$connect();
    repo = new PrismaQuestionAuthoringRepository(prisma);
    errorCodes = (await prisma.errorTaxonomy.findMany({ select: { code: true } })).map((t) => t.code);
    authoring = new ContentAuthoringService({ questions: repo, packs: new PrismaExamPackRepository(prisma), patternFamiliesFor: (code) => (code === "IPMAT_INDORE" ? percentagesPatternFamilies : []), errorTaxonomyCodes: errorCodes });
  });

  afterAll(async () => {
    const rows = await prisma.question.findMany({ where: { id: { in: created } }, select: { provenanceId: true } });
    await prisma.question.deleteMany({ where: { id: { in: created } } });
    await prisma.provenance.deleteMany({ where: { id: { in: rows.flatMap((r) => (r.provenanceId ? [r.provenanceId] : [])) } } });
    await prisma.$disconnect();
  });

  it("generation persists an ai_generated candidate through the existing authoring tables: ai_validated, never published, DNA read back equals the request", async () => {
    const spec = specFor(advancedCell, `${RUN}-a`);
    const out = await engine(new Double(script(spec, stemFor("a")))).generateOne(spec);
    expect(out.kind).toBe("ai_validated_awaiting_review");
    created.push(out.questionId!);
    const stored = (await repo.findById(out.questionId!))!;
    expect(stored.origin).toBe("ai_generated");
    expect(stored.validationState).toBe("ai_validated");
    expect(stored.source).toEqual({ sourceType: "original", sourceRef: `ai-generation:${out.trace.traceId}`, licenseRef: null, attributedTo: null });
    expect(stored.independentReverification).toEqual({ derivedAnswer: validReverification.derivedAnswer }); // the SECOND call's answer, persisted
    expect(out.trace.recordedDna).toEqual(out.trace.requestedDna);
    expect(out.trace.dnaDifferences).toEqual([]);
    expect(out.trace.gates!.gates).toHaveLength(11);
    const row = await prisma.question.findUnique({ where: { id: out.questionId! }, select: { validationState: true, authoringOrigin: true } });
    expect(row).toEqual({ validationState: "ai_validated", authoringOrigin: "ai_generated" });
  });

  it("the model's reasoning and any extra field are not persisted anywhere in the question row or its provenance", async () => {
    const spec = specFor(advancedCell, `${RUN}-b`);
    const out = await engine(new Double(script(spec, stemFor("b")))).generateOne(spec);
    created.push(out.questionId!);
    const row = await prisma.question.findUnique({ where: { id: out.questionId! }, include: { provenance: true } });
    expect(JSON.stringify(row)).not.toContain(REASONING);
    expect(JSON.stringify(out.trace)).not.toContain(REASONING);
    expect(JSON.stringify(traces.traces)).not.toContain(REASONING);
  });

  it("an exact duplicate against real rows is refused: still one row, unchanged, existing id returned", async () => {
    const spec = specFor(advancedCell, `${RUN}-c`);
    const first = await engine(new Double(script(spec, stemFor("c")))).generateOne(spec);
    created.push(first.questionId!);
    const before = JSON.stringify(await repo.findById(first.questionId!));
    const again = await engine(new Double(script(spec, stemFor("c")))).generateOne(spec);
    expect(again.kind).toBe("exact_duplicate");
    expect(again.existingQuestionId).toBe(first.questionId);
    expect(JSON.stringify(await repo.findById(first.questionId!))).toBe(before);
    expect((await prisma.question.count({ where: { id: first.questionId! } }))).toBe(1);
  });

  it("a rejected candidate (drift) is stored as REJECTED with the spec's DNA, and does not block re-generation of the same wording", async () => {
    const spec = specFor(advancedCell, `${RUN}-d`);
    const drift = script(spec, stemFor("d"));
    const parsed = JSON.parse(drift[0]!);
    parsed.questionDna.conceptName = "Averages";
    const out = await engine(new Double([JSON.stringify(parsed), drift[1]!, drift[2]!])).generateOne(spec);
    expect(out.kind).toBe("rejected_by_checks");
    created.push(out.questionId!);
    expect((await repo.findById(out.questionId!))!.validationState).toBe("rejected");
    expect(out.trace.recordedDna).toEqual(out.trace.requestedDna);
    const retry = await engine(new Double(script(spec, stemFor("d")))).generateOne(spec);
    expect(retry.kind).toBe("ai_validated_awaiting_review"); // a rejected row never blocks the same wording (existing identity rule)
    created.push(retry.questionId!);
  });

  it("a candidate for a tier whose taxonomy cell exists but needs review: ai_validated, review required, publish blocked, then the existing path works", async () => {
    const spec = specFor(hardCell, `${RUN}-e`);
    const out = await engine(new Double(script(spec, stemFor("e")))).generateOne(spec);
    created.push(out.questionId!);
    expect(out.trace.reviewRequired).toBe(true);
    await expect(authoring.publish(out.questionId!)).rejects.toBeInstanceOf(AuthoringError);
    expect((await repo.findById(out.questionId!))!.validationState).toBe("ai_validated");
  });

  it("a spec whose DNA has no existing taxonomy cell cannot be stored (authoring never creates a cell) and nothing is left behind", async () => {
    const spec = specFor(advancedCell, `${RUN}-f`);
    // A different (still valid) trap for the same family: no seeded cell exists for it.
    const noCell = { ...spec, blueprint: { ...spec.blueprint, trapErrorTaxonomyCode: "sign_error" } };
    const out = await engine(new Double(script(noCell as GenerationSpec, stemFor("f")))).generateOne(noCell as GenerationSpec);
    expect(["spec_invalid", "not_storable"]).toContain(out.kind);
    expect(out.questionId).toBeNull();
  });

  it("student boundary: no generated candidate is visible to a student reader, whatever its state", async () => {
    const ids = [...created];
    const reader = new PrismaQuestionContentReader(prisma);
    for (const id of ids) expect(await reader.findPublishedById(id)).toBeNull();
    const exam = await prisma.exam.findUniqueOrThrow({ where: { code: "IPMAT_INDORE" }, select: { id: true } });
    const records = await new PrismaTrainingQuestionReader(prisma).findPublishedByExamId(exam.id);
    expect(records.some((r) => ids.includes(r.question.questionId))).toBe(false);
    expect(JSON.stringify(records)).not.toContain(RUN);
  });

  it("no generation table or column exists: generation reused the authoring model", async () => {
    const tables = await prisma.$queryRaw<Array<{ table_name: string }>>`select table_name from information_schema.tables where table_schema = 'public'`;
    expect(tables.some((t) => /generat/i.test(t.table_name))).toBe(false);
  });
});
