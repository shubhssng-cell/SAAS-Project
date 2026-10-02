import { createHash } from "node:crypto";
import {
  ContentIntelligenceError,
  type BlockKind,
  type DetectedQuestion,
  type ExtractedBlock,
  type ExtractedDocument,
  type SourceFormat,
  type SourceLocation
} from "./types.js";

/**
 * Deterministic document extraction (docs/DECISIONS.md D-085). No model, no
 * network, no clock: the same normalized text always yields the same blocks.
 * The repository had no document parser, so this is a small, honest one for
 * the two text formats it supports (`plain_text`, `markdown`). PDF, OCR and
 * other formats are NOT supported and fail with `unsupported_format` - they
 * would be added behind this same `extractDocument` boundary, never silently
 * guessed at.
 *
 * Every block keeps its source location (lines, character span, heading
 * path); nothing is dropped during extraction.
 */

const SUPPORTED: readonly SourceFormat[] = ["plain_text", "markdown"];

/** Newlines, Unicode form, BOM and trailing spaces only: line structure (and so line numbers) is preserved. */
export function normalizeText(raw: string): string {
  return raw
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .normalize("NFKC")
    .split("\n")
    .map((line) => line.replace(/[ \t\u00a0]+$/g, ""))
    .join("\n");
}

const sha256 = (text: string): string => createHash("sha256").update(text, "utf8").digest("hex");
export const textHash = sha256;

interface Line {
  text: string;
  start: number;
  end: number;
  no: number;
}

const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const QUESTION_START = /^(?:Q\s*)?(\d{1,3})[.)]\s+(\S.*)$/i;
const OPTION = /^\(?([A-Da-d])[.)]\s+(\S.*)$/;
const ANSWER = /^(?:answer|ans)\s*[:-]\s*\(?([A-Da-d]|[^\s].*?)\)?\s*$/i;
const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_SEPARATOR = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

function splitLines(text: string): Line[] {
  const lines: Line[] = [];
  let start = 0;
  text.split("\n").forEach((t, i) => {
    lines.push({ text: t, start, end: start + t.length, no: i + 1 });
    start += t.length + 1;
  });
  return lines;
}

const parseRow = (line: string): string[] => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());

export function extractDocument(format: SourceFormat, rawContent: string): ExtractedDocument {
  if (!SUPPORTED.includes(format)) throw new ContentIntelligenceError("unsupported_format", `format "${String(format)}" is not supported (supported: ${SUPPORTED.join(", ")})`);
  if (typeof rawContent !== "string" || rawContent.trim() === "") throw new ContentIntelligenceError("empty_document", "the document has no content");
  const normalizedText = normalizeText(rawContent);
  const lines = splitLines(normalizedText);
  const blocks: ExtractedBlock[] = [];
  const headingPath: Array<{ level: number; text: string }> = [];
  const currentPath = (): string[] => headingPath.map((h) => h.text);

  const push = (kind: BlockKind, from: Line, to: Line, extra: Partial<Pick<ExtractedBlock, "level" | "rows" | "question">> = {}) => {
    const location: SourceLocation = { lineStart: from.no, lineEnd: to.no, charStart: from.start, charEnd: to.end, page: null, headingPath: currentPath() };
    blocks.push({ kind, text: normalizedText.slice(from.start, to.end), location, level: extra.level ?? null, rows: extra.rows ?? null, question: extra.question ?? null });
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.text.trim() === "") { i += 1; continue; }

    if (format === "markdown") {
      const h = HEADING.exec(line.text);
      if (h) {
        const level = h[1]!.length;
        while (headingPath.length > 0 && headingPath[headingPath.length - 1]!.level >= level) headingPath.pop();
        headingPath.push({ level, text: h[2]!.trim() });
        push("heading", line, line, { level });
        i += 1;
        continue;
      }
      if (TABLE_ROW.test(line.text) && i + 1 < lines.length && TABLE_SEPARATOR.test(lines[i + 1]!.text)) {
        let j = i + 2;
        while (j < lines.length && TABLE_ROW.test(lines[j]!.text)) j += 1;
        const rows = [parseRow(line.text), ...lines.slice(i + 2, j).map((l) => parseRow(l.text))];
        push("table", line, lines[j - 1]!, { rows });
        i = j;
        continue;
      }
    }

    const q = QUESTION_START.exec(line.text);
    if (q) {
      const detected = detectQuestion(lines, i);
      if (detected) {
        push("question", line, lines[detected.endIndex]!, { question: detected.question });
        i = detected.endIndex + 1;
        continue;
      }
    }

    let j = i;
    while (j + 1 < lines.length && lines[j + 1]!.text.trim() !== "" && !(format === "markdown" && (HEADING.test(lines[j + 1]!.text) || TABLE_ROW.test(lines[j + 1]!.text))) && !startsQuestion(lines, j + 1)) j += 1;
    push("paragraph", line, lines[j]!);
    i = j + 1;
  }

  const document: ExtractedDocument = { normalizedText, normalizedTextHash: sha256(normalizedText), blocks };
  validateExtraction(document);
  return document;
}

const startsQuestion = (lines: Line[], at: number): boolean => QUESTION_START.test(lines[at]!.text) && detectQuestion(lines, at) !== null;

/** A numbered line is a question ONLY if at least two lettered options follow it; otherwise it is ordinary text (a numbered list item). */
function detectQuestion(lines: Line[], at: number): { question: DetectedQuestion; endIndex: number } | null {
  const first = QUESTION_START.exec(lines[at]!.text)!;
  const stem: string[] = [first[2]!.trim()];
  const options: string[] = [];
  let answerClaim: string | null = null;
  let k = at + 1;
  while (k < lines.length && lines[k]!.text.trim() !== "") {
    const text = lines[k]!.text;
    const opt = OPTION.exec(text);
    const ans = ANSWER.exec(text.trim());
    if (opt) options.push(opt[2]!.trim());
    else if (ans && options.length >= 2) { answerClaim = ans[1]!.trim(); k += 1; break; }
    else if (options.length === 0) stem.push(text.trim());
    else break; // text after the options that is not an option or an answer line: not part of this question
    k += 1;
  }
  if (options.length < 2) return null;
  return { question: { label: first[1]!, stem: stem.join(" "), options, answerClaim }, endIndex: k - 1 };
}

/** Structural invariants every extraction must satisfy; a violation is `invalid_extraction`, never silently accepted. */
export function validateExtraction(doc: ExtractedDocument): void {
  const bad = (message: string): never => {
    throw new ContentIntelligenceError("invalid_extraction", message);
  };
  if (doc.blocks.length === 0) bad("no blocks were extracted");
  let cursor = 0;
  for (const [index, b] of doc.blocks.entries()) {
    const { charStart, charEnd, lineStart, lineEnd } = b.location;
    if (!Number.isInteger(charStart) || !Number.isInteger(charEnd) || charStart < cursor || charEnd <= charStart || charEnd > doc.normalizedText.length) bad(`block ${index} has an invalid or overlapping character span`);
    if (doc.normalizedText.slice(charStart, charEnd) !== b.text) bad(`block ${index} text does not match its span`);
    if (lineStart < 1 || lineEnd < lineStart) bad(`block ${index} has an invalid line range`);
    if (b.kind === "question" && (!b.question || b.question.options.length < 2)) bad(`question block ${index} lacks a detected question`);
    if (b.kind === "table" && (!b.rows || b.rows.length < 2)) bad(`table block ${index} lacks rows`);
    cursor = charEnd;
  }
}
