import type { AuthoredQuestion } from "@ipmat/content-authoring";
import type { GenerationTrace } from "./types.js";

/**
 * Where traces go. A durable store is NOT built in this unit (the existing
 * authoring model has no column for generation provenance beyond the
 * `source.sourceRef` reference to the trace id, and adding a table for
 * convenience was explicitly out of scope - D-094). A caller may implement this
 * over any store; the engine only requires `record`.
 */
export interface GenerationTraceSink {
  record(trace: GenerationTrace): void | Promise<void>;
}

export class InMemoryGenerationTraceSink implements GenerationTraceSink {
  readonly traces: GenerationTrace[] = [];
  record(trace: GenerationTrace): void {
    this.traces.push(structuredClone(trace));
  }
  byQuestionId(id: string): GenerationTrace | undefined {
    return this.traces.find((t) => t.questionId === id);
  }
  byTraceId(traceId: string): GenerationTrace | undefined {
    return this.traces.find((t) => t.traceId === traceId);
  }
}

/**
 * The ONLY view of a stored candidate meant to leave the authoring boundary
 * (a reviewer queue, a future staff screen). Built field by field: no answer,
 * no solution steps, no derivation, no DNA internals, no origin, source
 * reference, fingerprint, review notes or gate detail. A reviewer who needs
 * the answer uses the authoring repository's internal `findById`.
 */
export interface PublicCandidateView {
  id: string;
  body: string;
  options: string[];
  answerFormat: string;
  validationState: string;
}

export function toPublicCandidateView(q: AuthoredQuestion): PublicCandidateView {
  return { id: q.id, body: q.content.body, options: [...q.content.options], answerFormat: q.content.answerFormat, validationState: q.validationState };
}
