import { describe, expect, it } from "vitest";
import { chunkDocument, chunkProblems, DEFAULT_CHUNKER_CONFIG, extractDocument } from "../src/index.js";
import { FIXTURE_NOTES, rng } from "./fixtures.js";

const VERSION = "ver_test";
const docOf = (text = FIXTURE_NOTES) => extractDocument("markdown", text);

describe("chunk identity, ordering and linkage", () => {
  const doc = docOf();
  const chunks = chunkDocument(doc, VERSION);

  it("every chunk links to its source version, has a dense ordinal and a deterministic id", () => {
    expect(chunks.map((c) => c.ordinal)).toEqual(chunks.map((_, i) => i));
    for (const c of chunks) {
      expect(c.sourceVersionId).toBe(VERSION);
      expect(c.id).toMatch(/^chk_[0-9a-f]{32}$/);
      expect(c.validationState).toBe("unreviewed"); // existing is not validated
    }
    expect(new Set(chunks.map((c) => c.id)).size).toBe(chunks.length);
  });
  it("the same document, version and config always yields the same chunks and ids (idempotent reruns)", () => {
    expect(chunkDocument(docOf(), VERSION)).toEqual(chunks);
  });
  it("a different version, config or text changes the ids", () => {
    expect(chunkDocument(doc, "ver_other").map((c) => c.id)).not.toEqual(chunks.map((c) => c.id));
    expect(chunkDocument(doc, VERSION, { ...DEFAULT_CHUNKER_CONFIG, algorithmVersion: 2 }).map((c) => c.id)).not.toEqual(chunks.map((c) => c.id));
    expect(chunkDocument(docOf(FIXTURE_NOTES.replace("200", "300")), VERSION).map((c) => c.id)).not.toEqual(chunks.map((c) => c.id));
  });
  it("each chunk's text is exactly its span of the normalized text, with location and hash (traceable)", () => {
    expect(chunkProblems(chunks, doc)).toEqual([]);
    for (const c of chunks) expect(doc.normalizedText.slice(c.location.charStart, c.location.charEnd)).toBe(c.text);
  });
  it("keeps structural context: a heading starts a chunk and travels with what follows; headings paths are kept", () => {
    expect(chunks[0]!.text.startsWith("# Synthetic Fixture Notes")).toBe(true);
    const percentages = chunks.find((c) => c.text.includes("## Percentages"))!;
    expect(percentages.text).toContain("parts per hundred");
    expect(percentages.location.headingPath).toEqual(["Synthetic Fixture Notes", "Percentages"]); // a heading block's own path includes itself
    const averages = chunks.find((c) => c.text.startsWith("## Averages"))!;
    expect(averages.text).toContain("weighted reasoning".replace("w", "W"));
  });
  it("a detected question is always its own chunk, boundary preserved", () => {
    const q = chunks.filter((c) => c.blockKinds.includes("question"));
    expect(q).toHaveLength(1);
    expect(q[0]!.blockKinds).toEqual(["question"]);
    expect(q[0]!.text.startsWith("1. In this synthetic example")).toBe(true);
    expect(q[0]!.text.endsWith("Answer: B")).toBe(true);
  });
  it("tables stay whole inside a chunk", () => {
    const t = chunks.find((c) => c.blockKinds.includes("table"))!;
    expect(t.text).toContain("| Base | 200 |");
    expect(t.text).toContain("| Rate | 10 |");
  });
  it("line ranges are 1-based and consistent with the text", () => {
    for (const c of chunks) {
      expect(doc.normalizedText.split("\n").slice(c.location.lineStart - 1, c.location.lineEnd).join("\n")).toContain(c.text.split("\n")[0]!);
    }
  });
});

describe("size handling", () => {
  it("packs small blocks together up to maxChars and splits above it", () => {
    const text = Array.from({ length: 20 }, (_, i) => `Paragraph number ${i} with some filler words to take space.`).join("\n\n");
    const small = chunkDocument(docOf(text), VERSION, { maxChars: 150, algorithmVersion: 1 });
    expect(small.length).toBeGreaterThan(5);
    for (const c of small) expect(c.text.length).toBeLessThanOrEqual(150 + 60);
    expect(chunkDocument(docOf(text), VERSION, { maxChars: 100000, algorithmVersion: 1 })).toHaveLength(1);
  });
  it("splits an over-long paragraph at sentence boundaries, losing nothing", () => {
    const sentences = Array.from({ length: 30 }, (_, i) => `Sentence ${i} states a synthetic fact.`);
    const doc = docOf(sentences.join(" "));
    const chunks = chunkDocument(doc, VERSION, { maxChars: 120, algorithmVersion: 1 });
    expect(chunks.length).toBeGreaterThan(5);
    expect(chunkProblems(chunks, doc)).toEqual([]);
    for (const c of chunks.slice(0, -1)) expect(c.text.trim().endsWith(".")).toBe(true);
    const rejoined = chunks.map((c) => c.text).join(" ");
    for (let i = 0; i < 30; i++) expect(rejoined).toContain(`Sentence ${i} states`);
  });
  it("a single sentence longer than maxChars is hard-split rather than looping", () => {
    const doc = docOf("x".repeat(1000));
    const chunks = chunkDocument(doc, VERSION, { maxChars: 100, algorithmVersion: 1 });
    expect(chunks).toHaveLength(10);
    expect(chunkProblems(chunks, doc)).toEqual([]);
  });
});

describe("chunkProblems detects corrupt chunk sets", () => {
  it("catches wrong ordinals, overlaps, stale hashes and mismatched text", () => {
    const doc = docOf();
    const good = chunkDocument(doc, VERSION);
    const mutate = (f: (c: typeof good) => void): string[] => {
      const c = structuredClone(good);
      f(c);
      return chunkProblems(c, doc);
    };
    expect(mutate((c) => { c[1]!.ordinal = 7; })).not.toEqual([]);
    expect(mutate((c) => { c[1]!.location.charStart = 0; })).not.toEqual([]);
    expect(mutate((c) => { c[0]!.textHash = "stale"; })).not.toEqual([]);
    expect(mutate((c) => { c[0]!.text = "different"; })).not.toEqual([]);
  });
});

describe("property: chunk invariants over generated documents and configs", () => {
  const SEEDS = Array.from({ length: 60 }, (_, i) => i + 1);
  const pieces = ["# H1", "## H2", "A short paragraph.", "Another paragraph with several sentences. It keeps going. And going on.", "| a | b |\n|---|---|\n| 1 | 2 |", "1. Q?\nA) one\nB) two", "z".repeat(300)];
  it.each(SEEDS)("seed %i: ordered, non-overlapping, covering every block, deterministic, ids unique", (seed) => {
    const r = rng(seed);
    const text = Array.from({ length: 2 + Math.floor(r() * 14) }, () => pieces[Math.floor(r() * pieces.length)]).join("\n\n");
    const doc = docOf(text);
    const config = { maxChars: 60 + Math.floor(r() * 400), algorithmVersion: 1 };
    const chunks = chunkDocument(doc, VERSION, config);
    expect(chunkProblems(chunks, doc)).toEqual([]);
    expect(chunkDocument(doc, VERSION, config)).toEqual(chunks);
    expect(new Set(chunks.map((c) => c.id)).size).toBe(chunks.length);
    // nothing is lost: every non-whitespace character of every block lies inside some chunk (a long block may span several)
    const inChunk = (offset: number): boolean => chunks.some((c) => offset >= c.location.charStart && offset < c.location.charEnd);
    for (const b of doc.blocks) for (let o = b.location.charStart; o < b.location.charEnd; o++) if (!/\s/.test(doc.normalizedText[o]!)) expect(inChunk(o), `seed ${seed} offset ${o}`).toBe(true);
    const questions = doc.blocks.filter((b) => b.kind === "question").length;
    expect(chunks.filter((c) => c.blockKinds.includes("question")).length).toBe(questions);
  });
});
