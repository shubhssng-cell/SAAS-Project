import { describe, expect, it } from "vitest";
import { evaluateGates, GATE_NAMES, type AuthoredQuestion, type GateName, type GateResult } from "../src/index.js";
import { baseDna, baseQuestion, ctx, ERROR_TAXONOMY_CODES, otherExamPack, REVIEW } from "./fixtures.js";

const gate = (q: AuthoredQuestion, name: GateName, c = ctx()): GateResult => evaluateGates(q, c).gates.find((g) => g.gate === name)!;
const codes = (q: AuthoredQuestion, name: GateName, c = ctx()): string[] => gate(q, name, c).reasons.map((r) => r.code);
const withContent = (over: Partial<AuthoredQuestion["content"]>) => baseQuestion("q", { content: { ...baseQuestion().content, ...over } });

describe("gate report shape", () => {
  it("reports every gate, in a fixed order, each with a status and machine-readable reasons - not one boolean", () => {
    const report = evaluateGates(baseQuestion(), ctx());
    expect(report.gates.map((g) => g.gate)).toEqual([...GATE_NAMES]);
    for (const g of report.gates) expect(["passed", "failed", "requires_human", "not_applicable"]).toContain(g.status);
  });

  it("a clean human-authored Advanced question passes every gate; it is not 'publishable' only because it is still a draft", () => {
    const report = evaluateGates(baseQuestion(), ctx());
    expect(report.failed).toEqual([]);
    expect(report.requiresHuman).toEqual([]);
    expect(report.publishable).toBe(false); // lifecycle: a draft has not been validated
    expect(evaluateGates(baseQuestion("q", { validationState: "ai_validated" }), ctx()).publishable).toBe(true);
  });

  it("is deterministic and never mutates the question", () => {
    const q = baseQuestion();
    const snapshot = JSON.stringify(q);
    expect(evaluateGates(q, ctx())).toEqual(evaluateGates(q, ctx()));
    expect(JSON.stringify(q)).toBe(snapshot);
  });

  it("does not throw on a thoroughly malformed question; it reports", () => {
    const broken = { ...baseQuestion(), content: { body: null, answerFormat: "x", options: null, correctAnswer: 5, solutionSteps: "no", groundTruthDerivation: { computation: 1, expectedAnswer: "x" } }, dna: { ...baseDna(), difficultyDimensions: undefined, testingModes: undefined }, source: { sourceType: "bogus" } } as unknown as AuthoredQuestion;
    expect(() => evaluateGates(broken, ctx())).not.toThrow();
    expect(evaluateGates(broken, ctx()).failed.length).toBeGreaterThan(3);
  });
});

describe("structure gate", () => {
  it.each([
    ["body_too_short", { body: "Too short" }],
    ["missing_correct_answer", { correctAnswer: " " }],
    ["missing_solution_steps", { solutionSteps: [] }],
    ["invalid_answer_format", { answerFormat: "essay" as never }],
    ["multiple_or_no_correct_answer", { correctAnswer: "999" }],
    ["distractor_quality", { options: ["16,000", "16,000", "20,000", "24,000"] }]
  ])("%s", (code, patch) => {
    expect(codes(withContent(patch as never), "structure")).toContain(code);
  });

  it("a multiple-choice question needs options; a numeric-entry question must not have them", () => {
    expect(codes(withContent({ options: [] }), "structure")).toContain("multiple_or_no_correct_answer");
    expect(codes(withContent({ answerFormat: "numeric_entry" }), "structure")).toContain("numeric_entry_has_options");
    expect(codes(withContent({ answerFormat: "numeric_entry", options: [] }), "structure")).toEqual([]);
  });

  it("rejects a stem that states its own answer, and a literal-completeness claim", () => {
    expect(codes(withContent({ body: "The original population of Town A was 20,000 before a 20% increase made it three times Town B." }), "structure")).toContain("answer_leakage_in_stem");
    expect(codes(withContent({ body: demoBody() + " This set covers every possible question." }), "structure")).toContain("unsupported_completeness_claim");
  });
});

function demoBody() {
  return baseQuestion().content.body;
}

describe("metadata gate", () => {
  it("requires an id and a known exam-relevance label (an editorial label, not a prediction)", () => {
    expect(codes(baseQuestion(""), "metadata")).toContain("missing_id");
    expect(codes(baseQuestion("q", { dna: baseDna({ examRelevance: "very_likely" as never }) }), "metadata")).toContain("unknown_exam_relevance");
  });
  it("requires a skill and a pattern family", () => {
    expect(codes(baseQuestion("q", { dna: baseDna({ skill: " " }) }), "metadata")).toContain("missing_metadata");
    expect(codes(baseQuestion("q", { dna: baseDna({ patternFamilyName: "" }) }), "metadata")).toContain("missing_metadata");
  });
  it("rejects an unknown origin", () => {
    expect(codes(baseQuestion("q", { origin: "scraped" as never }), "metadata")).toContain("unknown_origin");
  });
});

describe("DNA, concept, pattern, difficulty/novelty and time gates reuse Prompt 2's validation, partitioned by what each establishes", () => {
  it("dna: exam mismatch, self-combination, 'combined' with no partners, duplicate modes, unknown trap", () => {
    expect(codes(baseQuestion("q", { dna: baseDna({ examCode: "OTHER_EXAM" }) }), "dna")).toContain("exam_mismatch");
    expect(codes(baseQuestion("q", { dna: baseDna({ combinesWithConcepts: ["Percentages"] }) }), "dna")).toContain("contradictory_metadata");
    expect(codes(baseQuestion("q", { dna: baseDna({ combinesWithConcepts: [], testingModes: ["combined"] }) }), "dna")).toContain("contradictory_metadata");
    expect(codes(baseQuestion("q", { dna: baseDna({ testingModes: ["reverse", "reverse"] }) }), "dna")).toContain("duplicate_entries");
    expect(codes(baseQuestion("q", { dna: baseDna({ trapErrorTaxonomyCode: "invented_trap" }) }), "dna")).toContain("unknown_trap");
  });
  it("concept: unknown section/chapter/concept and a concept outside its claimed chapter", () => {
    expect(codes(baseQuestion("q", { dna: baseDna({ sectionName: "Verbal" }) }), "concept")).toContain("unknown_section");
    expect(codes(baseQuestion("q", { dna: baseDna({ chapterName: "Probability" }) }), "concept")).toContain("concept_not_in_chapter");
    expect(codes(baseQuestion("q", { dna: baseDna({ conceptName: "Nope" }) }), "concept")).toContain("unknown_concept");
    expect(codes(baseQuestion("q", { dna: baseDna({ prerequisites: ["Nope"] }) }), "concept")).toContain("unknown_concept");
  });
  it("pattern: a pattern family must exist for THAT concept", () => {
    expect(codes(baseQuestion("q", { dna: baseDna({ patternFamilyName: "Nope" }) }), "pattern")).toContain("unknown_pattern_family");
  });
  it("difficulty_novelty: unknown tier/novelty, out-of-range or invented dimensions", () => {
    expect(codes(baseQuestion("q", { dna: baseDna({ difficultyTier: "brutal" as never }) }), "difficulty_novelty")).toContain("invalid_difficulty");
    expect(codes(baseQuestion("q", { dna: baseDna({ noveltyLevel: "alien" as never }) }), "difficulty_novelty")).toContain("invalid_novelty");
    const dna = baseDna();
    dna.difficultyDimensions = { ...dna.difficultyDimensions, trapDensity: 2 };
    expect(codes(baseQuestion("q", { dna }), "difficulty_novelty")).toContain("invalid_difficulty");
  });
  it("difficulty is NOT cross-checked against time, novelty or modes: long-but-easy and novel-but-easy are legal", () => {
    const easy = { conceptualLoad: 0.1, computationalLoad: 0.1, trapDensity: 0.1, representationNovelty: 0.1, timePressure: 0.1, multiStepDepth: 0.1 };
    const q = baseQuestion("q", { dna: baseDna({ difficultyDimensions: easy, expectedTimeSeconds: 600, noveltyLevel: "novel_representation", testingModes: ["time_pressured", "reverse"] }) });
    for (const g of ["difficulty_novelty", "expected_time", "dna"] as const) expect(gate(q, g).status).toBe("passed");
  });
  it("expected_time: positive whole seconds", () => {
    for (const bad of [0, -1, 1.5, Number.NaN]) expect(codes(baseQuestion("q", { dna: baseDna({ expectedTimeSeconds: bad }) }), "expected_time")).toContain("invalid_expected_time");
  });
  it("cross-exam: IPMAT DNA is rejected against another exam's pack even with overlapping concept names", () => {
    const report = evaluateGates(baseQuestion(), ctx({ pack: otherExamPack() }));
    expect(report.failed).toContain("dna");
  });
});

describe("answer gate: correctness is never taken on the generator's word", () => {
  it("a derivation that recomputes to the stated answer passes for human-authored content", () => {
    expect(gate(baseQuestion(), "answer").status).toBe("passed");
  });
  it("a derivation that does NOT match fails, with the deterministic verifier's own code", () => {
    expect(codes(withContent({ groundTruthDerivation: { computation: "(3 * 8000) / 1.25", expectedAnswer: 19200 } }), "answer")).toContain("answer_mismatch");
    expect(codes(withContent({ groundTruthDerivation: { computation: "(3 * 8000) / 1.20", expectedAnswer: 21000 } }), "answer")).toContain("answer_mismatch");
  });
  it("an unsafe or impossible computation is refused without evaluation", () => {
    expect(codes(withContent({ groundTruthDerivation: { computation: "process.exit(1)", expectedAnswer: 1 } }), "answer")).toContain("impossible_computation");
    expect(codes(withContent({ groundTruthDerivation: { computation: "1/0", expectedAnswer: 1 } }), "answer")).toContain("impossible_computation");
  });
  it("an unparseable stated answer fails closed (never silently skipped)", () => {
    expect(codes(withContent({ correctAnswer: "about twenty thousand", options: ["16,000", "about twenty thousand"] }), "answer")).toContain("unverifiable_answer");
  });
  it("a malformed derivation is reported, not thrown", () => {
    expect(codes(withContent({ groundTruthDerivation: { computation: " ", expectedAnswer: 1 } }), "answer")).toContain("malformed_derivation");
  });
  it("no derivation -> the answer REQUIRES A HUMAN, explicitly; a named reviewer's verification settles it", () => {
    const q = withContent({ groundTruthDerivation: null });
    expect(gate(q, "answer").status).toBe("requires_human");
    expect(codes(q, "answer")).toEqual(["no_deterministic_derivation"]);
    expect(gate({ ...q, review: { ...REVIEW, answerVerifiedByReviewer: true } }, "answer").status).toBe("passed");
    expect(gate({ ...q, review: { ...REVIEW, reviewedBy: " ", answerVerifiedByReviewer: true } }, "answer").status).toBe("requires_human");
  });
  it("a reviewer can NOT override a failed recomputation", () => {
    const q = { ...withContent({ groundTruthDerivation: { computation: "(3 * 8000) / 1.25", expectedAnswer: 19200 } }), review: { ...REVIEW, answerVerifiedByReviewer: true } };
    expect(gate(q, "answer").status).toBe("failed");
  });
  it("AI-generated: a matching derivation alone is NOT enough; it needs an independent re-derivation or a reviewer", () => {
    const ai = baseQuestion("q", { origin: "ai_generated", source: { sourceType: "original", sourceRef: "ai-generation:run-1", licenseRef: null, attributedTo: null } });
    expect(gate(ai, "answer").status).toBe("requires_human");
    expect(codes(ai, "answer")).toEqual(["ai_answer_needs_independent_check"]);
    expect(gate({ ...ai, independentReverification: { derivedAnswer: "20000" } }, "answer").status).toBe("passed");
    expect(codes({ ...ai, independentReverification: { derivedAnswer: "18000" } }, "answer")).toContain("answer_mismatch");
    expect(gate({ ...ai, review: { ...REVIEW, answerVerifiedByReviewer: true } }, "answer").status).toBe("passed");
  });
});

describe("identity gate", () => {
  const existing = (id: string, body: string, options: string[], state = "published" as const) => ({ id, body, fingerprint: "", validationState: state, options });
  it("an exact logical duplicate (same wording and options, any formatting) fails", async () => {
    const { computeContentFingerprint } = await import("../src/index.js");
    const q = baseQuestion();
    const ref = { id: "other", body: q.content.body.toUpperCase().replace(/ /g, "  "), validationState: "published" as const, fingerprint: computeContentFingerprint("IPMAT_INDORE", q.content.body.toUpperCase().replace(/ /g, "  "), [...q.content.options].reverse()) };
    expect(codes(q, "identity", ctx({ existing: [ref] }))).toEqual(["exact_duplicate"]);
  });
  it("the question itself, and rejected questions, are never its duplicates", async () => {
    const { computeContentFingerprint } = await import("../src/index.js");
    const q = baseQuestion();
    const fp = computeContentFingerprint("IPMAT_INDORE", q.content.body, q.content.options);
    expect(gate(q, "identity", ctx({ existing: [{ id: q.id, body: q.content.body, fingerprint: fp, validationState: "draft" }] })).status).toBe("passed");
    expect(gate(q, "identity", ctx({ existing: [{ id: "x", body: q.content.body, fingerprint: fp, validationState: "rejected" }] })).status).toBe("passed");
  });
  it("a near-duplicate needs a human and is never merged; the reviewer's explicit 'distinct' settles it", () => {
    const q = baseQuestion();
    const near = { id: "n", body: q.content.body.replace("8,000", "9,000"), fingerprint: "different", validationState: "published" as const };
    expect(gate(q, "identity", ctx({ existing: [near] })).status).toBe("requires_human");
    expect(codes(q, "identity", ctx({ existing: [near] }))).toEqual(["near_duplicate"]);
    expect(gate({ ...q, review: { ...REVIEW, reviewedAsDistinct: true } }, "identity", ctx({ existing: [near] })).status).toBe("passed");
  });
  void existing;
});

describe("provenance / rights gate", () => {
  const src = (over: Partial<AuthoredQuestion["source"]>) => baseQuestion("q", { source: { sourceType: "original", sourceRef: null, licenseRef: null, attributedTo: null, ...over } });
  it("original content needs no external reference", () => expect(gate(src({}), "provenance").status).toBe("passed"));
  it("a non-original source must be traceable and state its rights basis (free-to-access is not free-to-copy)", () => {
    expect(codes(src({ sourceType: "licensed" }), "provenance")).toEqual(["source_ref_required", "license_ref_required"]);
    expect(codes(src({ sourceType: "official", sourceRef: "doc-1" }), "provenance")).toEqual(["license_ref_required"]);
    expect(gate(src({ sourceType: "licensed", sourceRef: "doc-1", licenseRef: "agreement-7" }), "provenance").status).toBe("passed");
    expect(gate(src({ sourceType: "public_domain", sourceRef: "doc-1" }), "provenance").status).toBe("passed");
  });
  it.each(["open_license", "user_authorized"] as const)("%s also needs a license reference", (sourceType) => {
    expect(codes(src({ sourceType, sourceRef: "r" }), "provenance")).toContain("license_ref_required");
  });
  it("an unknown source type fails", () => expect(codes(src({ sourceType: "scraped" as never }), "provenance")).toContain("unknown_source_type"));
  it("a reference naming a known unauthorized-distribution channel is refused", () => {
    for (const ref of ["https://t.me/coaching_pdfs/12", "telegram dump", "libgen mirror", "torrent batch"]) {
      expect(codes(src({ sourceType: "licensed", sourceRef: ref, licenseRef: "x" }), "provenance"), ref).toContain("unauthorized_source_marker");
    }
  });
  it("AI-generated content must reference its generation record", () => {
    expect(codes(baseQuestion("q", { origin: "ai_generated" }), "provenance")).toContain("ai_generation_reference_required");
  });
});

describe("review gate", () => {
  it("standard/advanced tiers: not applicable. hard/extreme/novel require a human review, explicitly", () => {
    expect(gate(baseQuestion(), "review").status).toBe("not_applicable");
    for (const tier of ["hard", "extreme", "novel"] as const) {
      const q = baseQuestion("q", { dna: baseDna({ difficultyTier: tier }), validationState: "ai_validated" });
      expect(gate(q, "review").status, tier).toBe("requires_human");
      expect(codes(q, "review")).toEqual(["human_review_required"]);
      expect(gate({ ...q, validationState: "human_reviewed", review: REVIEW }, "review").status).toBe("passed");
    }
  });
  it("human_reviewed without a review record fails; an invalid record fails", () => {
    expect(codes(baseQuestion("q", { validationState: "human_reviewed" }), "review")).toEqual(["review_record_missing"]);
    expect(codes(baseQuestion("q", { review: { ...REVIEW, reviewedBy: "" } }), "review")).toEqual(["review_record_invalid"]);
    expect(codes(baseQuestion("q", { review: { ...REVIEW, reviewedAt: "yesterday" } }), "review")).toEqual(["review_record_invalid"]);
  });
});

describe("publication eligibility", () => {
  it("blocked by any failed gate, any open human gate, and by lifecycle state", () => {
    expect(evaluateGates(baseQuestion("q", { validationState: "ai_validated", content: { ...baseQuestion().content, correctAnswer: "999" } }), ctx()).publishable).toBe(false);
    expect(evaluateGates(baseQuestion("q", { validationState: "ai_validated", dna: baseDna({ difficultyTier: "hard" }) }), ctx()).publishable).toBe(false);
    for (const state of ["draft", "rejected", "published"] as const) expect(evaluateGates(baseQuestion("q", { validationState: state }), ctx()).publishable, state).toBe(false);
    expect(evaluateGates(baseQuestion("q", { validationState: "human_reviewed", review: REVIEW, dna: baseDna({ difficultyTier: "hard" }) }), ctx()).publishable).toBe(true);
  });
  it("uses the existing trap vocabulary only", () => {
    expect(ERROR_TAXONOMY_CODES).toContain(baseDna().trapErrorTaxonomyCode);
  });
});
