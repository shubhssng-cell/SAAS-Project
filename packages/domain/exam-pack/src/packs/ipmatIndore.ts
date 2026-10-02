import { percentagesConceptGraph } from "@ipmat/concept-graph";
import { slugKey } from "../semantics.js";
import type { ExamPack, PackProvenance } from "../types.js";

/**
 * IPMAT Indore, represented as DATA inside the generic Exam Pack
 * abstraction (docs/DECISIONS.md D-082). This is the ONLY file in the
 * package that names a specific exam; the generic modules never do.
 *
 * What this pack honestly contains: ONLY what the repository already holds -
 * the Quant section, the 15 Quant chapters seeded since Phase 1, and the 12
 * concepts / 16 typed relations of the human-curated Percentages
 * neighborhood (Phase 2). The repository has NO official IPMAT syllabus
 * document, so:
 *   - every artifact is `authored` + `unvalidated`, never `canonical`;
 *   - no other IPMAT section exists in this pack (none is invented);
 *   - terminology, skills, pattern references and importance are left empty/null
 *     (no authoritative source to derive them from);
 *   - concepts outside the Percentages neighborhood do not exist yet.
 */

export const IPMAT_INDORE_EXAM_CODE = "IPMAT_INDORE";

/**
 * The Quant chapter catalog, in syllabus order (index + 1 is the persisted
 * `order`). `packages/db/prisma/seed.ts` consumes this list, so the seeded
 * database and this pack cannot drift apart.
 */
export const IPMAT_QUANT_CHAPTERS: readonly string[] = [
  "Number Systems",
  "Percentages",
  "Ratio and Proportion",
  "Averages",
  "Profit and Loss",
  "Simple and Compound Interest",
  "Mixtures and Alligations",
  "Time, Speed and Distance",
  "Time and Work",
  "Algebra",
  "Geometry and Mensuration",
  "Data Interpretation",
  "Permutation and Combination",
  "Probability",
  "Sequences and Series"
];

const STRUCTURE_SOURCE =
  "repository seed (packages/db/prisma/seed.ts, Phase 1/2 Quant chapter catalog) - NOT verified against an official IPMAT syllabus";
const CONCEPT_SOURCE =
  "packages/domain/concept-graph/fixtures/percentages.ts (human-curated Percentages neighborhood, Phase 2; docs/QUESTION_ENGINE.md section 1)";

const unvalidatedAuthored = (sourceRef: string, note: string | null = null): PackProvenance => ({
  kind: "authored",
  sourceRef,
  licenseRef: null,
  reviewState: "unvalidated",
  reviewedBy: null,
  note
});

export const ipmatQuantSectionKey = "quant";
export const ipmatChapterNodeKey = (chapterName: string): string => `${ipmatQuantSectionKey}/${slugKey(chapterName)}`;

export function buildIpmatIndoreExamPack(): ExamPack {
  const structure = unvalidatedAuthored(STRUCTURE_SOURCE);
  const conceptSource = unvalidatedAuthored(CONCEPT_SOURCE);
  return {
    examCode: IPMAT_INDORE_EXAM_CODE,
    packVersion: "2026-10-02.1",
    name: "IPMAT Indore",
    provenance: unvalidatedAuthored(
      STRUCTURE_SOURCE,
      "Only the Quant section is represented; other sections are absent because the repository holds no authoritative structure for them."
    ),
    sections: [{ key: ipmatQuantSectionKey, name: "Quant", order: 1, provenance: structure }],
    syllabus: IPMAT_QUANT_CHAPTERS.map((name, index) => ({
      key: ipmatChapterNodeKey(name),
      sectionKey: ipmatQuantSectionKey,
      parentKey: null,
      name,
      order: index + 1,
      provenance: structure
    })),
    concepts: percentagesConceptGraph.concepts.map((c) => ({
      key: slugKey(c.name),
      name: c.name,
      syllabusNodeKey: ipmatChapterNodeKey(c.chapterName),
      description: c.description,
      status: c.status,
      skills: [],
      patternFamilyRefs: [],
      importance: null,
      provenance: conceptSource
    })),
    relations: percentagesConceptGraph.relations.map((r) => ({
      from: slugKey(r.from),
      to: slugKey(r.to),
      type: r.type,
      rationale: r.rationale,
      sharedKnowledge: r.sharedKnowledge,
      usefulForQuestionGeneration: r.usefulForQuestionGeneration,
      requirementLevel: r.requirementLevel,
      certainty: r.certainty,
      source: r.source,
      // The edge's own `certainty` is the author's claim and is kept as-is; the PACK-level review state stays
      // unvalidated because no review record exists. An ai_suggested edge would be `inferred`, never silently authored.
      provenance:
        r.source === "ai_suggested"
          ? { ...conceptSource, kind: "inferred" as const }
          : conceptSource
    })),
    terminology: []
  };
}

export const ipmatIndoreExamPack: ExamPack = buildIpmatIndoreExamPack();
