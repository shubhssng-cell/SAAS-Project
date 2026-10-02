import { ContentAuthoringService, InMemoryQuestionAuthoringRepository, type QuestionInstanceDna } from "@ipmat/content-authoring";
import { InMemoryExamPackRepository, ipmatIndoreExamPack } from "@ipmat/exam-pack";
import { percentagesPatternFamilies, percentagesReversePercentageExample } from "@ipmat/question-engine";
import { describe, expect, it } from "vitest";
import { questionDraftFromCandidate, type QuestionCandidate } from "../src/index.js";
import { FIXTURE_NOTES, fixtureSource, makeEnv, REVIEW } from "./fixtures.js";

const TAXONOMY = ["base_confusion", "sign_error", "misread_question", "careless_arithmetic", "successive_change_error", "percentage_point_confusion"];

function dna(over: Partial<QuestionInstanceDna> = {}): QuestionInstanceDna {
  const d: Record<string, unknown> = { ...percentagesReversePercentageExample.dna };
  delete d.provenanceSourceType;
  delete d.validationState;
  return { ...d, ...over } as QuestionInstanceDna;
}

async function setup() {
  const env = makeEnv();
  const { source } = await env.pipeline.registerSource(fixtureSource());
  const ing = await env.pipeline.ingest({ examCode: "IPMAT_INDORE", sourceKey: "fixture-notes", format: "markdown", content: FIXTURE_NOTES });
  const cand = (await env.repo.listCandidates(ing.version.id)).find((c) => c.kind === "question") as QuestionCandidate;
  const chunk = (await env.repo.listChunks(ing.version.id)).find((c) => c.id === cand.evidence[0]!.chunkId)!;
  const authoring = new ContentAuthoringService({
    questions: new InMemoryQuestionAuthoringRepository(),
    packs: new InMemoryExamPackRepository([ipmatIndoreExamPack]),
    patternFamiliesFor: () => percentagesPatternFamilies,
    errorTaxonomyCodes: TAXONOMY
  });
  return { env, source, version: ing.version, cand, chunk, authoring };
}

describe("question extraction -> existing authoring lifecycle", () => {
  it("an extracted question is a CANDIDATE: the pipeline produces no authored or published question by itself", async () => {
    const { cand, authoring } = await setup();
    expect(cand.state).toBe("candidate");
    expect(cand.detected).toMatchObject({ label: "1", options: ["10", "20", "30", "40"], answerClaim: "B" });
    expect(await authoring.examUniverse("IPMAT_INDORE")).toEqual(expect.any(Array));
  });

  it("only a candidate a reviewer ACCEPTED as a correct extraction can be bridged", async () => {
    const { env, cand, chunk, source, version } = await setup();
    const args = { candidate: cand, chunk, source, version, dna: dna(), dnaProposer: { kind: "human" as const, proposedBy: "editor" } };
    expect(() => questionDraftFromCandidate(args)).toThrow(/accepted/);
    const accepted = (await env.pipeline.reviewCandidate(cand.id, "accept", REVIEW)) as QuestionCandidate;
    expect(() => questionDraftFromCandidate({ ...args, candidate: accepted })).not.toThrow();
    const rejected = { ...cand, state: "rejected" as const };
    expect(() => questionDraftFromCandidate({ ...args, candidate: rejected })).toThrow();
  });

  it("the bridge yields a DRAFT's input: the source's own text, its answer only as a CLAIM, no invented solution, source-derived provenance", async () => {
    const { env, cand, chunk, source, version } = await setup();
    const accepted = (await env.pipeline.reviewCandidate(cand.id, "accept", REVIEW)) as QuestionCandidate;
    const input = questionDraftFromCandidate({ candidate: accepted, chunk, source, version, dna: dna(), dnaProposer: { kind: "human", proposedBy: "editor" } });
    expect(input.content).toMatchObject({ body: cand.detected.stem, options: ["10", "20", "30", "40"], correctAnswer: "20", solutionSteps: [], groundTruthDerivation: null });
    expect(input.source).toMatchObject({ sourceType: "original", sourceRef: `fixture-notes@v1#${chunk.id}`, licenseRef: null });
    expect(input.origin).toBe("human_authored");
    expect(input.id).toMatch(/^q_[0-9a-f]{32}$/);
    expect(JSON.stringify(input)).not.toMatch(/published/);
  });

  it("the extracted question cannot bypass any authoring gate: it is a draft, validation fails without a solution, and it can never be published", async () => {
    const { env, cand, chunk, source, version, authoring } = await setup();
    const accepted = (await env.pipeline.reviewCandidate(cand.id, "accept", REVIEW)) as QuestionCandidate;
    const input = questionDraftFromCandidate({ candidate: accepted, chunk, source, version, dna: dna(), dnaProposer: { kind: "human", proposedBy: "editor" } });
    const { id } = await authoring.createDraft(input);
    const report = await authoring.gateReport(id);
    expect(report.publishable).toBe(false);
    expect(report.failed).toContain("structure"); // missing solution steps - extraction invents none
    expect(report.requiresHuman).toContain("answer"); // the source's claim is not a verified answer
    const outcome = await authoring.validate(id);
    expect(outcome.advanced).toBe(false);
    await expect(authoring.publish(id)).rejects.toMatchObject({ code: "publication_blocked" });
  });

  it("DNA is validated by the authoring gates, not assumed: invalid DNA is rejected", async () => {
    const { env, cand, chunk, source, version, authoring } = await setup();
    const accepted = (await env.pipeline.reviewCandidate(cand.id, "accept", REVIEW)) as QuestionCandidate;
    const input = questionDraftFromCandidate({ candidate: accepted, chunk, source, version, dna: dna({ conceptName: "Nope", patternFamilyName: "Nope" }), dnaProposer: { kind: "human", proposedBy: "editor" } });
    const { id } = await authoring.createDraft(input);
    const report = await authoring.gateReport(id);
    expect(report.failed).toEqual(expect.arrayContaining(["concept", "pattern"]));
  });

  it("an AI-proposed classification gets the AI caution: its answer is not trusted on its own word", async () => {
    const { env, cand, chunk, source, version } = await setup();
    const accepted = (await env.pipeline.reviewCandidate(cand.id, "accept", REVIEW)) as QuestionCandidate;
    const input = questionDraftFromCandidate({ candidate: accepted, chunk, source, version, dna: dna(), dnaProposer: { kind: "ai_assisted", proposedBy: "provider@1" } });
    expect(input.origin).toBe("ai_generated");
  });

  it("extracting twice names the same question: the authoring identity does not duplicate", async () => {
    const { env, cand, chunk, source, version, authoring } = await setup();
    const accepted = (await env.pipeline.reviewCandidate(cand.id, "accept", REVIEW)) as QuestionCandidate;
    const make = () => questionDraftFromCandidate({ candidate: accepted, chunk, source, version, dna: dna(), dnaProposer: { kind: "human", proposedBy: "editor" } });
    const a = await authoring.createDraft(make());
    const b = await authoring.createDraft(make());
    expect(b).toEqual({ id: a.id, alreadyExisted: true });
  });

  it("mismatched candidate/chunk/version/source or exam are refused", async () => {
    const { env, cand, chunk, source, version } = await setup();
    const accepted = (await env.pipeline.reviewCandidate(cand.id, "accept", REVIEW)) as QuestionCandidate;
    const base = { candidate: accepted, chunk, source, version, dna: dna(), dnaProposer: { kind: "human" as const, proposedBy: "e" } };
    expect(() => questionDraftFromCandidate({ ...base, version: { ...version, id: "ver_other" } })).toThrow();
    expect(() => questionDraftFromCandidate({ ...base, dna: dna({ examCode: "OTHER_EXAM" }) })).toThrow(/same exam/);
    expect(() => questionDraftFromCandidate({ ...base, source: { ...source, id: "src_other" } })).toThrow();
  });
});
