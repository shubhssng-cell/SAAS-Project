import { describe, expect, it } from "vitest";
import { ContentIntelligenceError, contentHash, evaluateSource, registerableSource, sourceIdFor, sourceVersionIdFor, type SourceInput } from "../src/index.js";
import { fixtureSource } from "./fixtures.js";

const real = (over: Partial<SourceInput> = {}): SourceInput => ({ ...fixtureSource("real-doc"), dataOrigin: "real_source", fixtureLabel: null, sourceType: "licensed", sourceRef: "contract-2026-14", licenseRef: "license-14", authority: "Example Publisher Ltd", ...over });
const codeOf = (fn: () => unknown): string => {
  try {
    fn();
    return "ok";
  } catch (e) {
    return (e as ContentIntelligenceError).code;
  }
};
const reasons = (i: SourceInput) => { const r = evaluateSource(i); return [...r.rights, ...r.structure].map((x) => x.code); };

describe("source identity", () => {
  it("is deterministic from (exam, key): the same registration is the same source", () => {
    expect(sourceIdFor("A", "k")).toBe(sourceIdFor("A", "k"));
    expect(sourceIdFor("A", "k")).not.toBe(sourceIdFor("B", "k"));
    expect(sourceIdFor("A", "k")).not.toBe(sourceIdFor("A", "k2"));
    expect(sourceIdFor("A", "k")).toMatch(/^src_[0-9a-f]{32}$/);
  });
  it("a version id is deterministic from (source, content hash)", () => {
    const id = sourceIdFor("A", "k");
    expect(sourceVersionIdFor(id, contentHash("x"))).toBe(sourceVersionIdFor(id, contentHash("x")));
    expect(sourceVersionIdFor(id, contentHash("x"))).not.toBe(sourceVersionIdFor(id, contentHash("y")));
  });
  it("the content hash is a sha256 of the exact content: any change changes it", () => {
    expect(contentHash("abc")).toMatch(/^[0-9a-f]{64}$/);
    expect(contentHash("abc")).toBe(contentHash("abc"));
    expect(contentHash("abc")).not.toBe(contentHash("abc "));
  });
  it("registration keeps the input and adds the id", () => {
    const s = registerableSource(fixtureSource());
    expect(s.id).toBe(sourceIdFor("IPMAT_INDORE", "fixture-notes"));
    expect(s.sourceKey).toBe("fixture-notes");
  });
});

describe("rights boundary (free-to-access is not free-to-copy)", () => {
  it("a properly licensed real source is accepted", () => expect(codeOf(() => registerableSource(real()))).toBe("ok"));
  it("public domain needs a reference but no license or authority", () => {
    expect(codeOf(() => registerableSource(real({ sourceType: "public_domain", licenseRef: null, authority: null })))).toBe("ok");
  });
  it.each(["licensed", "official", "open_license", "user_authorized"] as const)("%s without a license reference is refused as unauthorized", (sourceType) => {
    expect(codeOf(() => registerableSource(real({ sourceType, licenseRef: null })))).toBe("unauthorized_source");
  });
  it("third-party material without a named authority is refused", () => {
    expect(reasons(real({ authority: " " }))).toContain("authority_required");
    expect(codeOf(() => registerableSource(real({ authority: null })))).toBe("unauthorized_source");
  });
  it("a non-original source must be traceable", () => {
    expect(reasons(real({ sourceRef: null }))).toContain("source_ref_required");
  });
  it.each(["https://t.me/coaching_pdfs/55", "telegram dump of notes", "libgen mirror", "torrent batch 7", "Z-Library copy", "sci-hub"])("a reference naming an unauthorized-distribution channel is refused: %s", (ref) => {
    expect(codeOf(() => registerableSource(real({ sourceRef: ref })))).toBe("unauthorized_source");
    expect(reasons(real({ sourceRef: ref }))).toContain("unauthorized_source_marker");
  });
  it("an unknown source type is refused", () => {
    expect(codeOf(() => registerableSource(real({ sourceType: "scraped" as never })))).toBe("unauthorized_source");
  });
});

describe("real source vs fixture is never ambiguous", () => {
  it("a labelled fixture is accepted", () => expect(codeOf(() => registerableSource(fixtureSource()))).toBe("ok"));
  it("a fixture needs a label, must be original, and must use a fixture: reference", () => {
    expect(reasons(fixtureSource("f", { fixtureLabel: null }))).toContain("fixture_label_required");
    expect(reasons(fixtureSource("f", { sourceType: "official", licenseRef: "x", authority: "y" }))).toContain("fixture_must_be_original");
    expect(reasons(fixtureSource("f", { sourceRef: "https://example.org/real-paper" }))).toContain("fixture_ref_required");
  });
  it("a real source cannot carry a fixture label or a fixture: reference", () => {
    expect(reasons(real({ fixtureLabel: "x" }))).toContain("fixture_label_on_real_source");
    expect(reasons(real({ sourceRef: "fixture:disguised" }))).toContain("fixture_ref_on_real_source");
  });
  it("an unknown data origin is refused", () => {
    expect(reasons(real({ dataOrigin: "wild" as never }))).toContain("unknown_data_origin");
  });
});

describe("structure", () => {
  it.each([["Upper"], [""], ["has space"], ["-lead"], ["x".repeat(65)]])("rejects source key %j", (sourceKey) => {
    expect(codeOf(() => registerableSource(fixtureSource("ok", { sourceKey })))).toBe("invalid_source");
  });
  it("needs an exam and a title", () => {
    expect(reasons(fixtureSource("k", { examCode: "" }))).toContain("missing_exam");
    expect(reasons(fixtureSource("k", { title: " " }))).toContain("missing_title");
  });
});
