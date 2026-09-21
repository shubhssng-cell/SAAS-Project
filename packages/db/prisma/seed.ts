import { Prisma, PrismaClient } from "@prisma/client";
import { percentagesConceptGraph } from "@ipmat/concept-graph";
import { ipmatPrepPhaseTemplate } from "@ipmat/prep-phase";
import { errorTaxonomySeed } from "../seed-data/errorTaxonomy.js";

// Prisma's Json input type wants a plain InputJsonObject; our domain
// packages export strongly-typed interfaces instead. This is a type-level
// impedance mismatch at the Prisma boundary only — the runtime value is
// already plain, serializable data.
const asJson = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;

const prisma = new PrismaClient();

/**
 * The Quant chapter catalog for IPMAT Indore. Only "Percentages" gets a
 * concept graph / taxonomy / questions in this vertical slice — the rest
 * exist as rows because exam structure is data (docs/DATABASE.md), not
 * because they're being built out now (see docs/MASTER_PLAN.md "What
 * should explicitly NOT be built yet").
 */
const QUANT_CHAPTERS = [
  "Number Systems",
  "Percentages",
  "Ratio and Proportion",
  "Averages",
  "Profit and Loss",
  "Simple and Compound Interest",
  "Time, Speed and Distance",
  "Time and Work",
  "Algebra",
  "Geometry and Mensuration",
  "Data Interpretation",
  "Permutation and Combination",
  "Probability",
  "Sequences and Series"
];

const INTERNAL_TEST_STUDENT_AUTH_REF = "internal-test-student";

async function main() {
  const exam = await prisma.exam.upsert({
    where: { code: "IPMAT_INDORE" },
    update: {},
    create: {
      name: "IPMAT Indore",
      code: "IPMAT_INDORE",
      // A concrete resolved rule for this vertical slice's single cycle —
      // resolving arbitrary future cycles is out of scope for Phase 1
      // (see docs/DECISIONS.md and the Phase 1 implementation report).
      examDateRule: { type: "fixed_date", date: ipmatPrepPhaseTemplate.examDate }
    }
  });

  const quant = await prisma.section.upsert({
    where: { examId_name: { examId: exam.id, name: "Quant" } },
    update: {},
    create: { examId: exam.id, name: "Quant", order: 1 }
  });

  const chaptersByName = new Map<string, { id: string }>();
  for (const [index, name] of QUANT_CHAPTERS.entries()) {
    const chapter = await prisma.chapter.upsert({
      where: { sectionId_name: { sectionId: quant.id, name } },
      update: {},
      create: { sectionId: quant.id, name, order: index + 1 }
    });
    chaptersByName.set(name, chapter);
  }

  const percentagesChapter = chaptersByName.get("Percentages");
  if (!percentagesChapter) {
    throw new Error("Percentages chapter was not seeded — check QUANT_CHAPTERS");
  }

  const conceptsByName = new Map<string, { id: string }>();
  for (const node of percentagesConceptGraph.concepts) {
    const concept = await prisma.concept.upsert({
      where: { chapterId_name: { chapterId: percentagesChapter.id, name: node.name } },
      update: { description: node.description, status: node.status },
      create: {
        chapterId: percentagesChapter.id,
        name: node.name,
        description: node.description,
        status: node.status
      }
    });
    conceptsByName.set(node.name, concept);
  }

  for (const edge of percentagesConceptGraph.relations) {
    const fromConcept = conceptsByName.get(edge.from);
    const toConcept = conceptsByName.get(edge.to);
    if (!fromConcept || !toConcept) {
      throw new Error(`Concept relation references an unseeded concept: ${edge.from} -> ${edge.to}`);
    }
    await prisma.conceptRelation.upsert({
      where: {
        fromConceptId_toConceptId_type: {
          fromConceptId: fromConcept.id,
          toConceptId: toConcept.id,
          type: edge.type
        }
      },
      update: { strength: edge.strength, source: edge.source },
      create: {
        fromConceptId: fromConcept.id,
        toConceptId: toConcept.id,
        type: edge.type,
        strength: edge.strength,
        source: edge.source
      }
    });
  }

  for (const entry of errorTaxonomySeed) {
    await prisma.errorTaxonomy.upsert({
      where: { code: entry.code },
      update: { label: entry.label, description: entry.description },
      create: entry
    });
  }

  await prisma.prepPhaseTemplate.upsert({
    where: { examId: exam.id },
    update: { phaseCurve: asJson(ipmatPrepPhaseTemplate.phaseCurve) },
    create: { examId: exam.id, phaseCurve: asJson(ipmatPrepPhaseTemplate.phaseCurve) }
  });

  const testStudent = await prisma.student.upsert({
    where: { authRef: INTERNAL_TEST_STUDENT_AUTH_REF },
    update: {},
    create: { authRef: INTERNAL_TEST_STUDENT_AUTH_REF }
  });

  await prisma.enrollment.upsert({
    where: { studentId_examId: { studentId: testStudent.id, examId: exam.id } },
    update: {},
    create: { studentId: testStudent.id, examId: exam.id, enrolledAt: new Date() }
  });

  console.log("Seed complete:");
  console.log(`  Exam: ${exam.name} (${exam.code})`);
  console.log(`  Chapters: ${QUANT_CHAPTERS.length} (Percentages fully populated)`);
  console.log(`  Concepts: ${conceptsByName.size}`);
  console.log(`  Concept relations: ${percentagesConceptGraph.relations.length}`);
  console.log(`  Error taxonomy entries: ${errorTaxonomySeed.length}`);
  console.log(`  Internal test student enrolled: ${testStudent.id}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
