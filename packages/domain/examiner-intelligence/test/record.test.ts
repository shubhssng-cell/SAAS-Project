import { describe, expect, it } from "vitest";
import {
  InvalidAnnotationTransitionError,
  proposeAnnotation,
  recordReview,
  validateHistoricalRecord,
  type HistoricalIssueCode,
  type HistoricalQuestionRecord
} from "../src/index.js";
import { baseClassification, fixtureRecord, ipmatContext, otherExamPack, realSourceRecord } from "./fixtures.js";

const codes = (r: HistoricalQuestionRecord, ctx = ipmatContext()): HistoricalIssueCode[] => validateHistoricalRecord(r, ctx).issues.map((i) => i.code);
const raw = (over: Partial<HistoricalQuestionRecord> = {}) => realSourceRecord("raw", { annotationState: "raw_imported", classification: null, authorship: null, review: null, ...over });
const candidate = (over: Partial<HistoricalQuestionRecord> = {}) => realSourceRecord("cand", { annotationState: "candidate_annotation", review: null, ...over });

describe("historical record - fixture vs real source", () => {
  it("accepts a clearly labelled fixture", () => expect(validateHistoricalRecord(fixtureRecord("f1"), ipmatContext())).toEqual({ valid: true, issues: [] }));

  it("a fixture must be labelled, be 'original', and use a 'fixture:' reference so it can never pass as a real source", () => {
    expect(codes(fixtureRecord("f", { fixtureLabel: null }))).toContain("invalid_origin");
    expect(codes(fixtureRecord("f", { fixtureLabel: "  " }))).toContain("invalid_origin");
    expect(codes(fixtureRecord("f", { source: { sourceType: "official", sourceRef: "fixture:x", licenseRef: "l", attributedTo: null } }))).toContain("invalid_origin");
    expect(codes(fixtureRecord("f", { source: { sourceType: "original", sourceRef: "https://example.org/paper-2019", licenseRef: null, attributedTo: null } }))).toContain("invalid_origin");
  });

  it("a real-source record must not be 'original', must not carry a fixture label, and must state its rights basis unless public domain", () => {
    expect(codes(realSourceRecord("r", { source: { sourceType: "original", sourceRef: "doc", licenseRef: null, attributedTo: null } }))).toContain("invalid_origin");
    expect(codes(realSourceRecord("r", { fixtureLabel: FIXTURE() }))).toContain("invalid_origin");
    expect(codes(realSourceRecord("r", { source: { sourceType: "licensed", sourceRef: "doc", licenseRef: null, attributedTo: null } }))).toContain("invalid_source");
    expect(codes(realSourceRecord("r", { source: { sourceType: "official", sourceRef: "doc", licenseRef: " ", attributedTo: null } }))).toContain("invalid_source");
    expect(validateHistoricalRecord(realSourceRecord("r", { source: { sourceType: "public_domain", sourceRef: "doc", licenseRef: null, attributedTo: null } }), ipmatContext()).valid).toBe(true);
    expect(validateHistoricalRecord(realSourceRecord("r"), ipmatContext()).valid).toBe(true);
  });

  it("every record needs a source reference (source traceability)", () => {
    expect(codes(realSourceRecord("r", { source: { sourceType: "licensed", sourceRef: " ", licenseRef: "l", attributedTo: null } }))).toContain("invalid_source");
    expect(codes(realSourceRecord("r", { source: { sourceType: "bogus" as never, sourceRef: "x", licenseRef: "l", attributedTo: null } }))).toContain("invalid_source");
  });

  it("rejects an unknown data origin", () => expect(codes(fixtureRecord("f", { dataOrigin: "wild" as never }))).toContain("invalid_origin"));
});

function FIXTURE() {
  return "FIXTURE - pretending";
}

describe("historical record - locator", () => {
  it("accepts a sensible locator and rejects an impossible year or blank labels", () => {
    expect(validateHistoricalRecord(realSourceRecord("r", { locator: { examVersion: "v2", year: 2019, session: "Morning", questionLabel: "Q23" } }), ipmatContext()).valid).toBe(true);
    for (const year of [1800, 2500, 2019.5, Number.NaN]) expect(codes(realSourceRecord("r", { locator: { examVersion: null, year, session: null, questionLabel: null } })), String(year)).toContain("invalid_locator");
    expect(codes(realSourceRecord("r", { locator: { examVersion: " ", year: null, session: null, questionLabel: null } }))).toContain("invalid_locator");
  });
});

describe("historical record - annotation states and validation states", () => {
  it("a raw import carries no classification, authorship, review or editorial annotation", () => {
    expect(validateHistoricalRecord(raw(), ipmatContext()).valid).toBe(true);
    expect(codes(raw({ classification: baseClassification() }))).toContain("invalid_state");
    expect(codes(raw({ authorship: "human" }))).toContain("invalid_state");
    expect(codes(raw({ editorialRelevance: { label: "core", rationale: "r", annotatedBy: "a" } }))).toContain("invalid_state");
  });

  it("a candidate has a classification and authorship but NO review", () => {
    expect(validateHistoricalRecord(candidate(), ipmatContext()).valid).toBe(true);
    expect(codes(candidate({ classification: null }))).toContain("missing_metadata");
    expect(codes(candidate({ authorship: null }))).toContain("missing_metadata");
    expect(codes(candidate({ review: { reviewedBy: "x", reviewedAt: "2026-01-01" } }))).toContain("invalid_review");
  });

  it("reviewed_validated requires a named reviewer and an ISO date", () => {
    expect(codes(realSourceRecord("r", { review: null }))).toContain("invalid_review");
    expect(codes(realSourceRecord("r", { review: { reviewedBy: " ", reviewedAt: "2026-01-01" } }))).toContain("invalid_review");
    expect(codes(realSourceRecord("r", { review: { reviewedBy: "x", reviewedAt: "yesterday" } }))).toContain("invalid_review");
  });

  it("an AI-assisted annotation must identify its proposer, and a human one must not claim to be a model's", () => {
    expect(codes(candidate({ authorship: "ai_assisted", proposedBy: null }))).toContain("invalid_state");
    expect(validateHistoricalRecord(candidate({ authorship: "ai_assisted", proposedBy: "classifier-v1" }), ipmatContext()).valid).toBe(true);
    expect(codes(candidate({ authorship: "human", proposedBy: "classifier-v1" }))).toContain("invalid_state");
  });

  it("an AI proposal cannot be authoritative without a review record", () => {
    expect(codes(realSourceRecord("r", { authorship: "ai_assisted", proposedBy: "classifier-v1", review: null }))).toContain("invalid_review");
  });

  it("rejects an unknown annotation state", () => expect(codes(raw({ annotationState: "published" as never }))).toContain("invalid_state"));

  it("an invalid classification is rejected in EVERY state that has one (a bad candidate is not stored either)", () => {
    const bad = baseClassification({ conceptName: "Nope" });
    expect(codes(candidate({ classification: bad }))).toContain("unknown_concept");
    expect(codes(realSourceRecord("r", { classification: bad }))).toContain("unknown_concept");
  });
});

describe("state transitions", () => {
  it("raw -> candidate (AI proposal) -> reviewed, each step valid; the proposal is not authoritative until reviewed", () => {
    const proposed = proposeAnnotation(raw(), { classification: baseClassification(), authorship: "ai_assisted", proposedBy: "classifier-v1" });
    expect(proposed.annotationState).toBe("candidate_annotation");
    expect(proposed.review).toBeNull();
    expect(validateHistoricalRecord(proposed, ipmatContext()).valid).toBe(true);
    const reviewed = recordReview(proposed, { reviewedBy: "editor", reviewedAt: "2026-10-02T10:00:00.000Z" });
    expect(reviewed.annotationState).toBe("reviewed_validated");
    expect(reviewed.authorship).toBe("ai_assisted"); // provenance of the proposal is preserved after review
    expect(validateHistoricalRecord(reviewed, ipmatContext()).valid).toBe(true);
  });

  it("a raw import cannot be reviewed (nothing to review), and re-annotating a reviewed record drops the stale review", () => {
    expect(() => recordReview(raw(), { reviewedBy: "e", reviewedAt: "2026-01-01" })).toThrow(InvalidAnnotationTransitionError);
    const again = proposeAnnotation(realSourceRecord("r"), { classification: baseClassification({ skill: "A different skill" }), authorship: "human", proposedBy: null });
    expect(again.annotationState).toBe("candidate_annotation");
    expect(again.review).toBeNull();
  });

  it("transitions do not mutate their input", () => {
    const r = raw();
    const snapshot = JSON.stringify(r);
    proposeAnnotation(r, { classification: baseClassification(), authorship: "human", proposedBy: null });
    expect(JSON.stringify(r)).toBe(snapshot);
  });
});

describe("editorial relevance is an annotation, not evidence and not a prediction", () => {
  it("needs a label, rationale and annotator", () => {
    expect(validateHistoricalRecord(realSourceRecord("r", { editorialRelevance: { label: "core", rationale: "Typical pattern.", annotatedBy: "editor" } }), ipmatContext()).valid).toBe(true);
    expect(codes(realSourceRecord("r", { editorialRelevance: { label: "core", rationale: "", annotatedBy: "editor" } }))).toContain("invalid_editorial_relevance");
    expect(codes(realSourceRecord("r", { editorialRelevance: { label: "likely" as never, rationale: "r", annotatedBy: "e" } }))).toContain("invalid_editorial_relevance");
  });
});

describe("exam identity", () => {
  it("a record is only valid for its own exam's pack", () => {
    expect(codes(fixtureRecord("f"), { ...ipmatContext(), pack: otherExamPack() })).toContain("exam_mismatch");
    expect(codes(fixtureRecord("f", { examCode: "OTHER_EXAM" }))).toContain("exam_mismatch");
  });
});

describe("validation is total and does not mutate", () => {
  it("collects every problem in one pass without throwing", () => {
    const r = realSourceRecord("", { classification: baseClassification({ conceptName: "Nope", expectedTimeSeconds: 0, testingModes: [] }), source: { sourceType: "licensed", sourceRef: "", licenseRef: null, attributedTo: null } });
    const snapshot = JSON.stringify(r);
    const result = validateHistoricalRecord(r, ipmatContext());
    expect(result.valid).toBe(false);
    expect(new Set(result.issues.map((i) => i.code)).size).toBeGreaterThanOrEqual(5);
    expect(JSON.stringify(r)).toBe(snapshot);
  });
});
