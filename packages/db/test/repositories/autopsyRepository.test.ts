import { FixtureProvider, type AutopsyHypothesisAiOutput } from "@ipmat/ai";
import { toAutopsyEvidence, submitAttempt, startAttempt, recordAttemptEvent, type AttemptQuestionContext } from "@ipmat/attempt";
import { buildAutopsyOutput, confirmHypothesis, correctHypothesis, generateHypothesis, rejectHypothesis, type AutopsyQuestionContext } from "@ipmat/autopsy";
import { describe, expect, it } from "vitest";
import { InMemoryAutopsyRepository } from "../fixtures/inMemoryRepositories.js";

const t = (offsetSeconds: number): string => new Date(Date.parse("2026-09-22T10:00:00.000Z") + offsetSeconds * 1000).toISOString();

const attemptQuestionContext: AttemptQuestionContext = {
  questionId: "question-repo-1",
  conceptId: "concept-percentages",
  answerFormat: "multiple_choice",
  options: ["420", "450", "480", "500"],
  correctAnswer: "480",
  expectedTimeSeconds: 90
};

const autopsyQuestionContext: AutopsyQuestionContext = {
  questionId: attemptQuestionContext.questionId,
  examCode: "IPMAT_INDORE",
  sectionName: "Quant",
  chapterName: "Percentages",
  conceptName: "Percentages",
  patternFamilyName: "Reverse Percentage",
  patternTaxonomyCellId: "cell-repo-1",
  difficultyTier: "advanced",
  difficultyDimensions: { conceptualLoad: 0.4, computationalLoad: 0.3, trapDensity: 0.5, representationNovelty: 0.2, timePressure: 0.3, multiStepDepth: 0.4 },
  noveltyLevel: "standard",
  examRelevance: "core",
  testingModes: ["reverse"],
  trapErrorTaxonomyCode: "base_confusion",
  combinesWithConcepts: ["Ratio"]
};

const errorTaxonomy = [{ code: "base_confusion", label: "Base confusion", description: "Wrong base.", category: "misconception" as const }];

async function buildIncorrectAttemptOutput(attemptId: string) {
  let attempt = startAttempt({ id: attemptId, studentId: "student-1", questionId: attemptQuestionContext.questionId, enrollmentId: "enrollment-1", now: t(0) });
  attempt = recordAttemptEvent(attempt, { type: "answer_selected", occurredAt: t(1), selectedAnswer: "420" }, { studentId: "student-1", questionId: attemptQuestionContext.questionId });
  attempt = submitAttempt(attempt, { studentId: "student-1", questionId: attemptQuestionContext.questionId }, attemptQuestionContext, { now: t(30) });
  const evidence = toAutopsyEvidence(attempt, attemptQuestionContext);
  return buildAutopsyOutput({ evidence, question: autopsyQuestionContext, errorTaxonomy });
}

async function freshHypothesis(attemptId: string) {
  const output = await buildIncorrectAttemptOutput(attemptId);
  const aiHypothesis: AutopsyHypothesisAiOutput = {
    proposedErrorCategory: "misconception",
    proposedExplanation: "Applied the percentage change to the wrong base quantity.",
    supportingEvidence: ["Matched the designated trap (base_confusion)."],
    contradictoryEvidence: [],
    missingEvidence: [],
    modelConfidence: 0.7
  };
  const provider = new FixtureProvider([JSON.stringify(aiHypothesis)]);
  const hypothesis = await generateHypothesis(provider, { autopsyOutput: output });
  return { hypothesis, output };
}

describe("PrismaAutopsyRepository semantics (verified against InMemoryAutopsyRepository — same interface, no live DB)", () => {
  it("round-trips a save then find, resolving errorTaxonomyId from the candidate's proposedErrorTaxonomyCode", async () => {
    const repo = new InMemoryAutopsyRepository({ base_confusion: "taxonomy-row-id-1" });
    const { hypothesis, output } = await freshHypothesis("attempt-repo-1");

    const stored = await repo.save({ hypothesis, output });
    expect(stored.id).toBeTruthy();
    expect(stored.errorTaxonomyId).toBe("taxonomy-row-id-1");
    expect(stored.confirmed).toBeNull();

    const found = await repo.findByAttemptId("attempt-repo-1");
    expect(found).toEqual(stored);
  });

  it("findByAttemptId returns null for an attempt that was never saved", async () => {
    const repo = new InMemoryAutopsyRepository();
    expect(await repo.findByAttemptId("nonexistent")).toBeNull();
  });

  it("confirmed/rejected/corrected round-trip with the exact confirmed/studentCorrectionText mapping (docs/DECISIONS.md D-039)", async () => {
    const repo = new InMemoryAutopsyRepository({ base_confusion: "taxonomy-row-id-1" });

    const { hypothesis: h1 } = await freshHypothesis("attempt-repo-confirmed");
    const confirmed = confirmHypothesis(h1, { now: t(60) });
    const { output: output1 } = await freshHypothesis("attempt-repo-confirmed");
    const storedConfirmed = await repo.save({ hypothesis: confirmed, output: output1 });
    expect(storedConfirmed.confirmed).toBe(true);
    expect(storedConfirmed.studentCorrectionText).toBeNull();

    const { hypothesis: h2, output: output2 } = await freshHypothesis("attempt-repo-rejected");
    const rejected = rejectHypothesis(h2, { now: t(60) });
    const storedRejected = await repo.save({ hypothesis: rejected, output: output2 });
    expect(storedRejected.confirmed).toBe(false);
    expect(storedRejected.studentCorrectionText).toBeNull();

    const { hypothesis: h3, output: output3 } = await freshHypothesis("attempt-repo-corrected");
    const corrected = correctHypothesis(h3, "It was a sign error.", { now: t(60) });
    const storedCorrected = await repo.save({ hypothesis: corrected, output: output3 });
    expect(storedCorrected.confirmed).toBe(false);
    expect(storedCorrected.studentCorrectionText).toBe("It was a sign error.");
  });

  it("rejects saving a hypothesis whose attemptId does not match its AutopsyOutput's attemptId (invalid state combination)", async () => {
    const repo = new InMemoryAutopsyRepository();
    const { hypothesis } = await freshHypothesis("attempt-repo-a");
    const { output: mismatchedOutput } = await freshHypothesis("attempt-repo-b");

    await expect(repo.save({ hypothesis, output: mismatchedOutput })).rejects.toThrow(/does not match/);
  });

  it("saving twice for the same attemptId upserts the same row rather than creating a second one", async () => {
    const repo = new InMemoryAutopsyRepository({ base_confusion: "taxonomy-row-id-1" });
    const { hypothesis, output } = await freshHypothesis("attempt-repo-upsert");

    const first = await repo.save({ hypothesis, output });
    const confirmed = confirmHypothesis(hypothesis, { now: t(60) });
    const second = await repo.save({ hypothesis: confirmed, output });

    expect(second.id).toBe(first.id);
    expect(second.confirmed).toBe(true);
  });

  it("fails closed when a proposed error-taxonomy code cannot be resolved, instead of silently writing null (foreign-key resolution cannot silently produce an invalid relation)", async () => {
    // No entry registered for "base_confusion" — the code the deterministic matcher
    // proposed does not exist in this repository's ErrorTaxonomy lookup.
    const repo = new InMemoryAutopsyRepository({});
    const { hypothesis, output } = await freshHypothesis("attempt-repo-unresolved-taxonomy");
    expect(output.candidateErrorEvidence?.proposedErrorTaxonomyCode).toBe("base_confusion");

    await expect(repo.save({ hypothesis, output })).rejects.toThrow(/No ErrorTaxonomy found with code "base_confusion"/);
  });

  // docs/DECISIONS.md D-039 addendum -- confirmedAt round-trip coverage.
  it("confirmedAt round-trips exactly as hypothesis.respondedAt, and is null while awaiting_confirmation", async () => {
    const repo = new InMemoryAutopsyRepository({ base_confusion: "taxonomy-row-id-1" });
    const { hypothesis, output } = await freshHypothesis("attempt-repo-confirmedAt");

    const storedAwaiting = await repo.save({ hypothesis, output });
    expect(storedAwaiting.confirmedAt).toBeNull();

    const confirmed = confirmHypothesis(hypothesis, { now: t(60) });
    const storedConfirmed = await repo.save({ hypothesis: confirmed, output });
    expect(storedConfirmed.confirmedAt).toBe(t(60));
    expect(storedConfirmed.confirmedAt).toBe(confirmed.respondedAt);

    const found = await repo.findByAttemptId("attempt-repo-confirmedAt");
    expect(found?.confirmedAt).toBe(t(60));
  });

  it("getById() resolves an Autopsy by its OWN id (not attemptId) -- the cross-lookup InMemoryRepairPlanRepository's join depends on", async () => {
    const repo = new InMemoryAutopsyRepository({ base_confusion: "taxonomy-row-id-1" });
    const { hypothesis, output } = await freshHypothesis("attempt-repo-getbyid");
    const stored = await repo.save({ hypothesis, output });

    expect(repo.getById(stored.id)).toEqual(stored);
    expect(repo.getById("nonexistent-id")).toBeNull();
  });
});
