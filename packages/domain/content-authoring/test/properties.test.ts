import { describe, expect, it } from "vitest";
import {
  buildConceptUniverse,
  computeContentFingerprint,
  createDraft,
  editQuestion,
  evaluateGates,
  proposeAiQuestion,
  publishQuestion,
  recordHumanReview,
  rejectQuestion,
  runAutomatedValidation,
  AuthoringError,
  type AuthoredQuestion
} from "../src/index.js";
import { ipmatIndoreExamPack } from "@ipmat/exam-pack";
import { percentagesPatternFamilies } from "@ipmat/question-engine";
import { baseDna, baseInput, ctx, REVIEW, rng } from "./fixtures.js";

/** Seeded-PRNG properties (no new dependency). The seed is in the test name. */
const SEEDS = Array.from({ length: 60 }, (_, i) => i + 1);
const TIERS = ["standard", "advanced", "hard", "extreme", "novel"] as const;
const aiSource = { sourceType: "original" as const, sourceRef: "ai-generation:run", licenseRef: null, attributedTo: null };

type Action = "validate" | "approve" | "reject_review" | "publish" | "edit" | "reject" | "verify";

function randomWalk(seed: number): { history: AuthoredQuestion[]; publishes: number } {
  const r = rng(seed);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
  const ai = r() < 0.4;
  const noDerivation = r() < 0.25;
  const input = baseInput(`w-${seed}`, { dna: baseDna({ difficultyTier: pick(TIERS) }), origin: ai ? "ai_generated" : "human_authored", ...(ai ? { source: aiSource } : {}) });
  if (noDerivation) input.content.groundTruthDerivation = null;
  let q: AuthoredQuestion = ai ? proposeAiQuestion(input) : createDraft(input);
  const history = [q];
  let publishes = 0;
  const actions: Action[] = ["validate", "approve", "reject_review", "publish", "edit", "reject", "verify"];
  for (let i = 0; i < 25; i++) {
    const action = pick(actions);
    try {
      if (action === "validate") q = runAutomatedValidation(q, ctx()).question;
      else if (action === "approve") q = recordHumanReview(q, { ...REVIEW, answerVerifiedByReviewer: r() < 0.5 }, "approve", ctx()).question;
      else if (action === "reject_review") q = recordHumanReview(q, REVIEW, "reject", ctx()).question;
      else if (action === "publish") { q = publishQuestion(q, ctx()); publishes += 1; }
      else if (action === "edit") q = editQuestion(q, { content: { ...q.content, solutionSteps: [`Step ${i}`] } });
      else if (action === "reject") q = rejectQuestion(q);
      else q = editQuestion(q, { independentReverification: { derivedAnswer: r() < 0.5 ? "20000" : "1" } });
      history.push(q);
    } catch (e) {
      if (!(e instanceof AuthoringError)) throw e;
    }
  }
  return { history, publishes };
}

describe("property: random authoring sequences", () => {
  it.each(SEEDS)("seed %i: a question is published only when every gate passes and the lifecycle allows it; the id never changes", (seed) => {
    const { history } = randomWalk(seed);
    for (const q of history) {
      expect(q.id).toBe(`w-${seed}`);
      if (q.validationState === "published") {
        // the state at the moment before publication was publishable; re-evaluating a published question must show no failed gate
        const report = evaluateGates(q, ctx());
        expect(report.failed, `seed ${seed}`).toEqual([]);
        expect(report.requiresHuman, `seed ${seed}`).toEqual([]);
      }
    }
  });

  it.each(SEEDS)("seed %i: terminal states are final", (seed) => {
    const { history } = randomWalk(seed);
    let terminal: string | null = null;
    for (const q of history) {
      if (terminal) expect(q.validationState).toBe(terminal);
      if (q.validationState === "published" || q.validationState === "rejected") terminal = q.validationState;
    }
  });

  it.each(SEEDS)("seed %i: an AI-generated question is never published without an independent check or a reviewer-verified answer", (seed) => {
    const { history } = randomWalk(seed);
    for (const q of history.filter((x) => x.origin === "ai_generated" && x.validationState === "published")) {
      expect(q.independentReverification !== null || q.review?.answerVerifiedByReviewer === true).toBe(true);
    }
  });

  it.each(SEEDS)("seed %i: hard/extreme/novel questions are never published without a review record", (seed) => {
    const { history } = randomWalk(seed);
    for (const q of history.filter((x) => x.validationState === "published" && ["hard", "extreme", "novel"].includes(x.dna.difficultyTier))) {
      expect(q.review).not.toBeNull();
    }
  });

  it.each(SEEDS)("seed %i: any edit returns the question to draft with no review", (seed) => {
    const r = rng(seed);
    const v = runAutomatedValidation(createDraft(baseInput("p")), ctx()).question;
    const reviewed = recordHumanReview(v, REVIEW, "approve", ctx()).question;
    const edited = editQuestion(reviewed, { dna: baseDna({ expectedTimeSeconds: 30 + Math.floor(r() * 300) }) });
    expect(edited.validationState).toBe("draft");
    expect(edited.review).toBeNull();
  });
});

describe("property: fingerprints and the universe", () => {
  it.each(SEEDS)("seed %i: the fingerprint ignores option order and case but separates different numbers", (seed) => {
    const r = rng(seed);
    const opts = Array.from({ length: 4 }, (_, i) => String(Math.floor(r() * 1000) + i));
    const shuffled = [...opts].sort(() => r() - 0.5);
    expect(computeContentFingerprint("E", "What is the value?", opts)).toBe(computeContentFingerprint("E", "WHAT IS  THE VALUE", shuffled));
    const n = Math.floor(r() * 1e6);
    expect(computeContentFingerprint("E", `Value ${n}`, [])).not.toBe(computeContentFingerprint("E", `Value ${n + 1}`, []));
  });

  it.each(SEEDS)("seed %i: universe counts are additive over lifecycle and independent of order", (seed) => {
    const r = rng(seed);
    const states = ["draft", "ai_validated", "human_reviewed", "published", "rejected"] as const;
    const refs = Array.from({ length: 5 + Math.floor(r() * 30) }, (_, i) => ({
      id: `u-${i}`,
      dna: baseDna({ noveltyLevel: (["standard", "novel_context"] as const)[Math.floor(r() * 2)]!, expectedTimeSeconds: 10 + Math.floor(r() * 300) }),
      validationState: states[Math.floor(r() * states.length)]!
    }));
    const u = buildConceptUniverse({ pack: ipmatIndoreExamPack, patternFamilies: percentagesPatternFamilies, questions: refs, conceptName: "Percentages" });
    const nonRejected = refs.filter((x) => x.validationState !== "rejected").length;
    const published = refs.filter((x) => x.validationState === "published").length;
    expect(u.totals).toMatchObject({ questions: nonRejected, published });
    expect(u.noveltyLevels.reduce((s, x) => s + x.total, 0)).toBe(nonRejected);
    expect(u.noveltyLevels.reduce((s, x) => s + x.published, 0)).toBe(published);
    expect(u.timeDemand.reduce((s, x) => s + x.published, 0)).toBe(published);
    expect(u.patterns.reduce((s, x) => s + x.total, 0)).toBe(nonRejected);
    expect(u.totals.distinctSignaturesPublished).toBeLessThanOrEqual(published);
    expect(buildConceptUniverse({ pack: ipmatIndoreExamPack, patternFamilies: percentagesPatternFamilies, questions: [...refs].reverse(), conceptName: "Percentages" })).toEqual(u);
  });
});
