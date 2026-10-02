import { createHash } from "node:crypto";
import { textHash } from "./extract.js";
import type { BlockKind, Chunk, ChunkerConfig, ExtractedBlock, ExtractedDocument, SourceLocation } from "./types.js";

/**
 * Deterministic semantic chunking (docs/DECISIONS.md D-085). A chunk is a
 * contiguous span of the normalized text that keeps its structural context:
 * a heading starts a new chunk and travels with what follows; a detected
 * question is always its own chunk (its boundary is preserved); paragraphs and
 * tables are packed up to `maxChars`; an over-long paragraph is split at
 * sentence boundaries. The same document, source version and config always
 * produce the same chunks with the same ids, so a rerun is idempotent.
 *
 * "Semantic" here means STRUCTURAL: a chunk existing does not mean it is
 * semantically correct, reviewed or meaningful - that is what review is for.
 */

export const DEFAULT_CHUNKER_CONFIG: ChunkerConfig = { maxChars: 1200, algorithmVersion: 1 };

const sha = (s: string): string => createHash("sha256").update(s, "utf8").digest("hex");

interface Span {
  start: number;
  end: number;
  kinds: BlockKind[];
  headingPath: string[];
}

function lineIndexFor(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") starts.push(i + 1);
  return starts;
}
const lineOf = (starts: number[], offset: number): number => {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid]! <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
};

/** Splits one block into pieces of at most `maxChars`, at sentence boundaries where possible. Pure and deterministic. */
function splitBlock(block: ExtractedBlock, maxChars: number): Span[] {
  const { charStart, charEnd, headingPath } = block.location;
  if (charEnd - charStart <= maxChars || block.kind !== "paragraph") return [{ start: charStart, end: charEnd, kinds: [block.kind], headingPath }];
  const spans: Span[] = [];
  const text = block.text;
  let pieceStart = 0;
  while (pieceStart < text.length) {
    let pieceEnd = Math.min(pieceStart + maxChars, text.length);
    if (pieceEnd < text.length) {
      const window = text.slice(pieceStart, pieceEnd);
      const boundary = Math.max(window.lastIndexOf(". "), window.lastIndexOf("? "), window.lastIndexOf("! "));
      if (boundary > 0) pieceEnd = pieceStart + boundary + 1;
    }
    spans.push({ start: charStart + pieceStart, end: charStart + pieceEnd, kinds: ["paragraph"], headingPath });
    pieceStart = pieceEnd;
    while (pieceStart < text.length && /\s/.test(text[pieceStart]!)) pieceStart += 1;
  }
  return spans;
}

export function chunkDocument(doc: ExtractedDocument, sourceVersionId: string, config: ChunkerConfig = DEFAULT_CHUNKER_CONFIG): Chunk[] {
  const starts = lineIndexFor(doc.normalizedText);
  const groups: Span[][] = [];
  let current: Span[] = [];
  const flush = () => {
    if (current.length > 0) groups.push(current);
    current = [];
  };

  for (const block of doc.blocks) {
    if (block.kind === "heading") flush(); // a heading starts a new chunk and travels with what follows
    for (const span of splitBlock(block, config.maxChars)) {
      if (span.kinds[0] === "question") {
        flush();
        groups.push([span]);
        continue;
      }
      const onlyHeading = current.length === 1 && current[0]!.kinds[0] === "heading";
      if (current.length > 0 && !onlyHeading && span.end - current[0]!.start > config.maxChars) flush();
      current.push(span);
    }
  }
  flush();

  return groups.map((group, ordinal) => {
    const start = group[0]!.start;
    const end = group[group.length - 1]!.end;
    const text = doc.normalizedText.slice(start, end);
    const location: SourceLocation = { lineStart: lineOf(starts, start), lineEnd: lineOf(starts, Math.max(start, end - 1)), charStart: start, charEnd: end, page: null, headingPath: group[0]!.headingPath };
    const hash = textHash(text);
    return {
      id: `chk_${sha(`${sourceVersionId}|${config.algorithmVersion}|${config.maxChars}|${ordinal}|${hash}`).slice(0, 32)}`,
      sourceVersionId,
      ordinal,
      text,
      textHash: hash,
      location,
      blockKinds: [...new Set(group.flatMap((s) => s.kinds))],
      validationState: "unreviewed" as const
    };
  });
}

/** Invariants every chunk set must satisfy: ordered, non-overlapping, in range, id-stable, and text equal to its span. */
export function chunkProblems(chunks: readonly Chunk[], doc: ExtractedDocument): string[] {
  const problems: string[] = [];
  let cursor = 0;
  chunks.forEach((c, i) => {
    if (c.ordinal !== i) problems.push(`chunk ${i} has ordinal ${c.ordinal}`);
    if (c.location.charStart < cursor) problems.push(`chunk ${i} overlaps the previous chunk`);
    if (c.location.charEnd > doc.normalizedText.length || doc.normalizedText.slice(c.location.charStart, c.location.charEnd) !== c.text) problems.push(`chunk ${i} text does not match its span`);
    if (c.textHash !== textHash(c.text)) problems.push(`chunk ${i} has a stale text hash`);
    cursor = c.location.charEnd;
  });
  return problems;
}
