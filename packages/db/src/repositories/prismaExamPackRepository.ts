import type { PrismaClient } from "@prisma/client";
import { EXTERNAL_REFERENCE_PREFIX, slugKey, type ExamPack, type ExamPackRepository, type PackProvenance } from "@ipmat/exam-pack";

/**
 * Assembles an `ExamPack` from the EXISTING exam catalog tables (exams ->
 * sections -> chapters -> concepts, plus concept_relations). Read-only; no
 * migration was needed (docs/DECISIONS.md D-082).
 *
 * Honesty about what the database does NOT store: it keeps no provenance or
 * review record for exam structure, so every assembled artifact is reported
 * as `authored` + `unvalidated` with a note saying so - persistence never
 * upgrades anything to reviewed/canonical. A relation row's own `source`
 * decides authored vs inferred. Keys are derived from names via `slugKey`,
 * which is exactly how the in-code pack derives them, so the two agree.
 *
 * Cross-exam isolation: the database does not (and, without a trigger,
 * cannot) forbid a relation whose endpoints sit in two different exams. This
 * reader loads every relation touching the exam and marks an endpoint that
 * belongs to ANOTHER exam with `EXTERNAL_REFERENCE_PREFIX`, so pack
 * validation reports it as `cross_exam_relation` instead of silently
 * dropping or following it.
 */
export class PrismaExamPackRepository implements ExamPackRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findByExamCode(examCode: string): Promise<ExamPack | null> {
    const exam = await this.prisma.exam.findUnique({
      where: { code: examCode },
      select: {
        code: true,
        name: true,
        sections: {
          orderBy: { order: "asc" },
          select: {
            name: true,
            order: true,
            chapters: {
              orderBy: { order: "asc" },
              select: {
                name: true,
                order: true,
                concepts: { orderBy: { name: "asc" }, select: { name: true, description: true, status: true } }
              }
            }
          }
        }
      }
    });
    if (!exam) return null;

    const examOfConcept = { chapter: { select: { section: { select: { exam: { select: { code: true } } } } } } } as const;
    const inThisExam = { chapter: { section: { exam: { code: examCode } } } };
    const relationRows = await this.prisma.conceptRelation.findMany({
      where: { OR: [{ fromConcept: inThisExam }, { toConcept: inThisExam }] },
      orderBy: [{ type: "asc" }, { id: "asc" }],
      select: {
        type: true,
        rationale: true,
        sharedKnowledge: true,
        usefulForQuestionGeneration: true,
        requirementLevel: true,
        certainty: true,
        source: true,
        fromConcept: { select: { name: true, ...examOfConcept } },
        toConcept: { select: { name: true, ...examOfConcept } }
      }
    });

    const provenance = (table: string, kind: PackProvenance["kind"] = "authored"): PackProvenance => ({
      kind,
      sourceRef: `database:${table}`,
      licenseRef: null,
      reviewState: "unvalidated",
      reviewedBy: null,
      note: "The database stores no provenance or review record for exam structure; reported as unvalidated."
    });

    const pack: ExamPack = {
      examCode: exam.code,
      packVersion: "database",
      name: exam.name,
      provenance: provenance("exams"),
      sections: [],
      syllabus: [],
      concepts: [],
      relations: [],
      terminology: []
    };

    for (const section of exam.sections) {
      const sectionKey = slugKey(section.name);
      pack.sections.push({ key: sectionKey, name: section.name, order: section.order, provenance: provenance("sections") });
      for (const chapter of section.chapters) {
        const nodeKey = `${sectionKey}/${slugKey(chapter.name)}`;
        pack.syllabus.push({ key: nodeKey, sectionKey, parentKey: null, name: chapter.name, order: chapter.order, provenance: provenance("chapters") });
        for (const concept of chapter.concepts) {
          pack.concepts.push({
            key: slugKey(concept.name),
            name: concept.name,
            syllabusNodeKey: nodeKey,
            description: concept.description ?? "",
            status: concept.status,
            skills: [],
            patternFamilyRefs: [],
            importance: null,
            provenance: provenance("concepts")
          });
        }
      }
    }

    const endpointKey = (c: { name: string; chapter: { section: { exam: { code: string } } } }): string =>
      c.chapter.section.exam.code === examCode ? slugKey(c.name) : `${EXTERNAL_REFERENCE_PREFIX}${c.chapter.section.exam.code}:${slugKey(c.name)}`;
    for (const row of relationRows) {
      pack.relations.push({
        from: endpointKey(row.fromConcept),
        to: endpointKey(row.toConcept),
        type: row.type,
        rationale: row.rationale,
        sharedKnowledge: row.sharedKnowledge,
        usefulForQuestionGeneration: row.usefulForQuestionGeneration,
        requirementLevel: row.requirementLevel,
        certainty: row.certainty,
        source: row.source,
        provenance: provenance("concept_relations", row.source === "ai_suggested" ? "inferred" : "authored")
      });
    }
    return pack;
  }
}
