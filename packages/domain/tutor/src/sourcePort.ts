import { ContentAccessDeniedError, type ContentPrincipal, type EvidenceRetriever } from "@ipmat/content-intelligence";
import type { TutorSourcePort } from "./types.js";

/**
 * Reuses the Phase 6 retrieval abstraction (`EvidenceRetriever`) - the tutor
 * has no second RAG system. The PRINCIPAL is supplied by the caller, never
 * constructed here: the content-intelligence retriever denies every `student`
 * principal, and the tutor does not weaken that. Consequence (recorded as an
 * unresolved product policy, D-092): for a student request this port returns
 * `denied`, the tutor records `sourceAccess: "denied"` and proceeds only on
 * the structured context, never on source text it was not entitled to.
 *
 * Fixtures are excluded by the retriever's own default. Hits already pass
 * through the exam-scoped repository there; the context builder re-checks the
 * exam again.
 */
export function createEvidenceRetrieverSourcePort(retriever: EvidenceRetriever, principal: ContentPrincipal): TutorSourcePort {
  return {
    async retrieve(query) {
      try {
        const hits = await retriever.retrieve(principal, { examCode: query.examCode, text: query.text, limit: query.limit });
        return {
          status: "ok",
          items: hits.map((h) => ({
            chunkId: h.chunkId,
            examCode: query.examCode,
            text: h.text,
            location: h.location.headingPath.length > 0 ? h.location.headingPath.join(" > ") : `lines ${h.location.lineStart}-${h.location.lineEnd}`,
            source: { sourceKey: h.source.sourceKey, title: h.source.title, version: h.source.version }
          }))
        };
      } catch (error) {
        if (error instanceof ContentAccessDeniedError) return { status: "denied" };
        throw error;
      }
    }
  };
}
