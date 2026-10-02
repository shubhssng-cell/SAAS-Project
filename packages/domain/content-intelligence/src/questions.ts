import { createHash } from "node:crypto";
import type { NewQuestionInput, QuestionInstanceDna } from "@ipmat/content-authoring";
import { ContentIntelligenceError, type Chunk, type Proposer, type QuestionCandidate, type SourceRecord, type SourceVersionRecord } from "./types.js";

/**
 * The question-extraction boundary (docs/DECISIONS.md D-085). An extracted
 * question enters the EXISTING content-authoring lifecycle as a DRAFT and
 * nothing else: it must still pass every gate (DNA, answer, provenance,
 * identity, review) before it can be published. This function can only
 * produce the input to `createDraft`; there is no path from here to
 * `published`, and an extracted question is never auto-published.
 *
 * What extraction can and cannot supply:
 *  - the stem, options and any answer the SOURCE states are copied as-is;
 *  - the source's answer is only a CLAIM: no derivation is attached, so the
 *    authoring `answer` gate requires a human to verify it;
 *  - NO solution is invented (the structure gate will say so);
 *  - Question DNA is NOT guessable from text: it must be supplied, by a person
 *    or a proposer, and goes through the DNA gates unchanged.
 */
export function questionDraftFromCandidate(args: {
  candidate: QuestionCandidate;
  chunk: Chunk;
  source: SourceRecord;
  version: SourceVersionRecord;
  /** Complete Question DNA proposed for this question. Validated by the authoring gates, not here. */
  dna: QuestionInstanceDna;
  dnaProposer: Proposer;
}): NewQuestionInput {
  const { candidate, chunk, source, version, dna, dnaProposer } = args;
  if (candidate.state !== "accepted") throw new ContentIntelligenceError("invalid_transition", "only a candidate a reviewer accepted as a correct extraction can enter the authoring lifecycle");
  if (candidate.sourceVersionId !== version.id || chunk.sourceVersionId !== version.id || version.sourceId !== source.id) throw new ContentIntelligenceError("invalid_candidate", "candidate, chunk, version and source do not belong together");
  if (dna.examCode !== candidate.examCode || source.examCode !== candidate.examCode) throw new ContentIntelligenceError("exam_mismatch", "the DNA, source and candidate must all belong to the same exam");
  const claim = candidate.detected.answerClaim;
  const letter = claim && /^[A-Da-d]$/.test(claim) ? candidate.detected.options[claim.toUpperCase().charCodeAt(0) - 65] : undefined;
  return {
    // Deterministic: extracting the same candidate twice names the same question (and the authoring fingerprint backstops it).
    id: `q_${createHash("sha256").update(`extracted\n${candidate.id}`).digest("hex").slice(0, 32)}`,
    dna,
    content: {
      body: candidate.detected.stem,
      answerFormat: "multiple_choice",
      options: [...candidate.detected.options],
      correctAnswer: letter ?? claim ?? "",
      solutionSteps: [],
      groundTruthDerivation: null
    },
    source: {
      sourceType: source.sourceType,
      sourceRef: `${source.sourceKey}@v${version.version}#${chunk.id}`,
      licenseRef: source.licenseRef,
      attributedTo: source.attributedTo
    },
    // A person's classification is human-authored; any model's is treated with the AI caution (its answer is never trusted on its own word).
    origin: dnaProposer.kind === "human" ? "human_authored" : "ai_generated"
  };
}
