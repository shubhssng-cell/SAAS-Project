import { createHash } from "node:crypto";

/**
 * Deterministic logical identity for a question's CONTENT within one exam.
 *
 * Two questions share a fingerprint only if, after trivial normalization
 * (Unicode NFKC, case, whitespace, and punctuation other than digits and the
 * characters `. % -` that carry numeric meaning), their wording AND their
 * option sets (order-independent) are identical. That is deliberately narrow:
 * it identifies "the same question typed twice", never "a similar question".
 * Similar-but-different questions are NOT merged here; the `identity` gate
 * flags near-duplicates for a human to decide (D-084, D-019).
 */
export function normalizeForFingerprint(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}.%\-\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function computeContentFingerprint(examCode: string, body: string, options: readonly string[]): string {
  const normalizedOptions = options.map(normalizeForFingerprint).sort();
  return createHash("sha256")
    .update([examCode, normalizeForFingerprint(body), normalizedOptions.join("|")].join("\n"))
    .digest("hex");
}
