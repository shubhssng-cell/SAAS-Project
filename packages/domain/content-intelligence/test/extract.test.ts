import { describe, expect, it } from "vitest";
import { ContentIntelligenceError, extractDocument, normalizeText, validateExtraction, type ExtractedDocument } from "../src/index.js";
import { FIXTURE_NOTES, rng } from "./fixtures.js";

const codeOf = (fn: () => unknown): string => {
  try {
    fn();
    return "ok";
  } catch (e) {
    return (e as ContentIntelligenceError).code;
  }
};

describe("normalization", () => {
  it("normalizes newlines, BOM, trailing spaces and Unicode form without changing line structure", () => {
    expect(normalizeText("﻿a  \r\nb\t\rc")).toBe("a\nb\nc");
    expect(normalizeText("ｆｕｌｌ")).toBe("full");
    expect(normalizeText("a\n\n\nb").split("\n")).toHaveLength(4);
  });
  it("is idempotent", () => {
    const once = normalizeText("  x \r\n y \r\n");
    expect(normalizeText(once)).toBe(once);
  });
});

describe("structure extraction (markdown)", () => {
  const doc = extractDocument("markdown", FIXTURE_NOTES);
  const kinds = doc.blocks.map((b) => b.kind);

  it("recognizes headings, paragraphs, a table and a question, in document order", () => {
    expect(kinds).toEqual(["heading", "heading", "paragraph", "table", "question", "heading", "paragraph"]);
  });
  it("keeps heading levels and the enclosing heading path on every block", () => {
    expect(doc.blocks[0]).toMatchObject({ kind: "heading", level: 1, location: { headingPath: ["Synthetic Fixture Notes"] } });
    expect(doc.blocks[2]!.location.headingPath).toEqual(["Synthetic Fixture Notes", "Percentages"]);
    expect(doc.blocks[6]!.location.headingPath).toEqual(["Synthetic Fixture Notes", "Averages"]);
  });
  it("parses tables into rows, header first", () => {
    expect(doc.blocks[3]!.rows).toEqual([["Quantity", "Value"], ["Base", "200"], ["Rate", "10"]]);
  });
  it("detects a question boundary with its options and the source's own answer claim", () => {
    expect(doc.blocks[4]!.question).toEqual({ label: "1", stem: "In this synthetic example, what is 10 percent of the base quantity 200?", options: ["10", "20", "30", "40"], answerClaim: "B" });
  });
  it("every block's text is exactly its span of the normalized text, with 1-based line numbers (traceable back to the source)", () => {
    for (const b of doc.blocks) {
      expect(doc.normalizedText.slice(b.location.charStart, b.location.charEnd)).toBe(b.text);
      expect(doc.normalizedText.split("\n").slice(b.location.lineStart - 1, b.location.lineEnd).join("\n")).toBe(b.text);
      expect(b.location.page).toBeNull();
    }
    expect(doc.blocks[0]!.location.lineStart).toBe(1);
  });
  it("is deterministic", () => {
    expect(extractDocument("markdown", FIXTURE_NOTES)).toEqual(doc);
  });
  it("nested headings reset the path correctly", () => {
    const d = extractDocument("markdown", "# A\n\n## B\n\ntext b\n\n# C\n\ntext c\n");
    expect(d.blocks.filter((b) => b.kind === "paragraph").map((b) => b.location.headingPath)).toEqual([["A", "B"], ["C"]]);
  });
});

describe("plain text", () => {
  it("has no headings or tables: '#' and pipes are just text", () => {
    const d = extractDocument("plain_text", "# not a heading\n\n| a | b |\n|---|---|\n| 1 | 2 |\n");
    expect(d.blocks.map((b) => b.kind)).toEqual(["paragraph", "paragraph"]);
  });
  it("still detects questions", () => {
    const d = extractDocument("plain_text", "Q3. A synthetic stem?\n(a) one\n(b) two\n");
    expect(d.blocks[0]!.question).toMatchObject({ label: "3", options: ["one", "two"], answerClaim: null });
  });
});

describe("question boundaries are conservative", () => {
  it("a numbered line WITHOUT options is a paragraph, not a question", () => {
    const d = extractDocument("markdown", "1. First item of an ordinary list\n2. Second item\n");
    expect(d.blocks.map((b) => b.kind)).toEqual(["paragraph"]);
  });
  it("a single option is not enough", () => {
    expect(extractDocument("markdown", "1. Stem?\nA) only one\n").blocks[0]!.kind).toBe("paragraph");
  });
  it("a multi-line stem is joined; text after the options ends the question", () => {
    const d = extractDocument("markdown", "2. Part one of the stem\ncontinues here?\nA) x\nB) y\nTrailing note that is not an option\n");
    expect(d.blocks[0]!.question!.stem).toBe("Part one of the stem continues here?");
    expect(d.blocks[0]!.question!.options).toEqual(["x", "y"]);
  });
  it("two questions in a row become two blocks", () => {
    const d = extractDocument("markdown", "1. First?\nA) a\nB) b\n2. Second?\nA) c\nB) d\n");
    expect(d.blocks.map((b) => b.question?.label)).toEqual(["1", "2"]);
  });
});

describe("failure modes", () => {
  it.each(["pdf", "docx", "image", ""])("unsupported format %j", (format) => {
    expect(codeOf(() => extractDocument(format as never, "text"))).toBe("unsupported_format");
  });
  it.each(["", "   \n\n  ", "﻿"])("an empty document is refused: %j", (content) => {
    expect(codeOf(() => extractDocument("markdown", content))).toBe("empty_document");
  });
  it("a non-string payload is refused", () => {
    expect(codeOf(() => extractDocument("markdown", null as never))).toBe("empty_document");
  });
  it("validateExtraction rejects corrupt artifacts", () => {
    const good = extractDocument("markdown", "# T\n\nbody text\n");
    const tamper = (f: (d: ExtractedDocument) => void): string => {
      const d = structuredClone(good);
      f(d);
      return codeOf(() => validateExtraction(d));
    };
    expect(tamper((d) => { d.blocks[1]!.text = "different"; })).toBe("invalid_extraction");
    expect(tamper((d) => { d.blocks[1]!.location.charEnd = 9999; })).toBe("invalid_extraction");
    expect(tamper((d) => { d.blocks[1]!.location.charStart = 0; })).toBe("invalid_extraction");
    expect(tamper((d) => { d.blocks = []; })).toBe("invalid_extraction");
    expect(tamper((d) => { d.blocks[0]!.location.lineStart = 0; })).toBe("invalid_extraction");
  });
});

describe("property: extraction invariants over generated documents", () => {
  const SEEDS = Array.from({ length: 60 }, (_, i) => i + 1);
  const pieces = ["# Title", "## Sub", "plain paragraph text here.", "another line of prose", "", "| a | b |\n|---|---|\n| 1 | 2 |", "1. Q stem?\nA) one\nB) two\nAnswer: A", "3) numbered but no options", "text with  trailing   ", "ｆｕｌｌｗｉｄｔｈ"];
  const make = (seed: number): string => {
    const r = rng(seed);
    return Array.from({ length: 3 + Math.floor(r() * 12) }, () => pieces[Math.floor(r() * pieces.length)]).join(r() < 0.5 ? "\n\n" : "\n");
  };
  it.each(SEEDS)("seed %i: blocks are ordered, non-overlapping, exactly equal to their spans, and the result is deterministic", (seed) => {
    const input = make(seed);
    if (input.trim() === "") return;
    const doc = extractDocument("markdown", input);
    expect(() => validateExtraction(doc)).not.toThrow();
    expect(extractDocument("markdown", input)).toEqual(doc);
    let cursor = 0;
    for (const b of doc.blocks) {
      expect(b.location.charStart).toBeGreaterThanOrEqual(cursor);
      expect(doc.normalizedText.slice(b.location.charStart, b.location.charEnd)).toBe(b.text);
      cursor = b.location.charEnd;
    }
    // nothing is silently dropped: every non-blank line is covered by some block
    const covered = new Set<number>();
    for (const b of doc.blocks) for (let l = b.location.lineStart; l <= b.location.lineEnd; l++) covered.add(l);
    doc.normalizedText.split("\n").forEach((line, i) => { if (line.trim() !== "") expect(covered.has(i + 1), `seed ${seed} line ${i + 1}`).toBe(true); });
  });
});
