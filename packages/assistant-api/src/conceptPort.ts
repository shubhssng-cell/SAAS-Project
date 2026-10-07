import type { ConceptGraph } from "@ipmat/concept-graph";
import { EXTERNAL_REFERENCE_PREFIX, type ExamPackRepository } from "@ipmat/exam-pack";
import type { TutorConceptPort } from "@ipmat/tutor";

/**
 * The tutor's concept port over the EXISTING exam pack (D-082): the concept graph of ONE exam, built from the pack's own
 * concepts and relations. A relation whose endpoint is outside the pack (another exam, `external:`) is dropped - the tutor can
 * never be shown a relation that crosses exams. A missing pack is an empty graph, never a guess.
 */
export class ExamPackTutorConceptPort implements TutorConceptPort {
  constructor(private readonly packs: ExamPackRepository) {}

  async getConceptGraph(examCode: string): Promise<ConceptGraph> {
    const pack = await this.packs.findByExamCode(examCode);
    if (!pack) return { concepts: [], relations: [] };
    const nodeName = new Map(pack.syllabus.map((n) => [n.key, n.name]));
    const byKey = new Map(pack.concepts.map((c) => [c.key, c]));
    const resolve = (ref: string): string | null => {
      if (ref.startsWith(EXTERNAL_REFERENCE_PREFIX)) return null;
      return byKey.get(ref)?.name ?? [...byKey.values()].find((c) => c.name === ref)?.name ?? null;
    };
    return {
      concepts: pack.concepts.map((c) => ({ name: c.name, chapterName: nodeName.get(c.syllabusNodeKey) ?? "", description: c.description, status: c.status })),
      relations: pack.relations.flatMap((r) => {
        const from = resolve(r.from);
        const to = resolve(r.to);
        if (from === null || to === null) return [];
        return [{ from, to, type: r.type, rationale: r.rationale, sharedKnowledge: r.sharedKnowledge, usefulForQuestionGeneration: r.usefulForQuestionGeneration, requirementLevel: r.requirementLevel, certainty: r.certainty, source: r.source }];
      })
    };
  }
}
