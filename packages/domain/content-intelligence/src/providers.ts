import type { ExamPack } from "@ipmat/exam-pack";
import { matchConceptNames } from "./candidates.js";
import type { Chunk } from "./types.js";

/**
 * Extraction providers (docs/DECISIONS.md D-085). Interfaces only: nothing
 * here names a vendor or calls a model. A provider returns RAW, UNTRUSTED
 * proposals - plain strings - and the pipeline turns each into a candidate
 * through the validators (a quote that is not verbatim in its chunk, an
 * unknown concept, an unestablished relation type are all rejected there).
 * Where extraction can be deterministic it is, and a model-backed provider
 * would implement these same interfaces (through `@ipmat/ai`'s
 * `generateStructured` with a Zod schema, per the project rule) - none is
 * built in this unit.
 */

export interface RawConceptProposal {
  /** The concept name the provider believes the passage refers to. */
  name: string;
  /** The exact words in the chunk that support it. */
  quote: string;
}

export interface RawRelationshipProposal {
  fromConceptName: string;
  toConceptName: string;
  /** Provider-supplied label; accepted ONLY if it is one of the eight established relation types. */
  relationType: string;
  rationale: string;
  quote: string;
}

export interface ProviderContext {
  pack: ExamPack;
}

export interface ConceptExtractionProvider {
  readonly name: string;
  readonly kind: "deterministic" | "ai_assisted";
  proposeConcepts(chunk: Chunk, ctx: ProviderContext): Promise<RawConceptProposal[]>;
}

export interface RelationshipExtractionProvider {
  readonly name: string;
  readonly kind: "deterministic" | "ai_assisted";
  proposeRelationships(chunk: Chunk, ctx: ProviderContext): Promise<RawRelationshipProposal[]>;
}

/** Whole-word, exact-name matching against the Exam Pack. Deterministic; the default. */
export class DeterministicConceptProvider implements ConceptExtractionProvider {
  readonly name = "deterministic-concept-name-matcher@1";
  readonly kind = "deterministic" as const;
  async proposeConcepts(chunk: Chunk, ctx: ProviderContext): Promise<RawConceptProposal[]> {
    return matchConceptNames(chunk, ctx.pack).map((m) => ({ name: m.name, quote: m.evidence.quote }));
  }
}

/** A fixed, scripted provider: the test double (and the shape of any real one). Its output is as untrusted as any provider's. */
export class StaticExtractionProvider implements ConceptExtractionProvider, RelationshipExtractionProvider {
  readonly kind: "deterministic" | "ai_assisted";
  constructor(
    readonly name: string,
    private readonly script: { concepts?: (chunk: Chunk) => RawConceptProposal[]; relationships?: (chunk: Chunk) => RawRelationshipProposal[]; fail?: (chunk: Chunk) => Error | null },
    kind: "deterministic" | "ai_assisted" = "ai_assisted"
  ) {
    this.kind = kind;
  }
  async proposeConcepts(chunk: Chunk): Promise<RawConceptProposal[]> {
    const failure = this.script.fail?.(chunk);
    if (failure) throw failure;
    return this.script.concepts?.(chunk) ?? [];
  }
  async proposeRelationships(chunk: Chunk): Promise<RawRelationshipProposal[]> {
    const failure = this.script.fail?.(chunk);
    if (failure) throw failure;
    return this.script.relationships?.(chunk) ?? [];
  }
}
