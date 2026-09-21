import { Prisma, PrismaClient } from "@prisma/client";
import { percentagesConceptGraph, percentagesConceptDepth, ratioConceptDepth } from "@ipmat/concept-graph";
import { percentagesLens } from "@ipmat/examiner-lens";
import { ipmatPrepPhaseTemplate } from "@ipmat/prep-phase";
import {
  percentagesPatternFamilies,
  percentagesTaxonomyCells,
  percentagesReversePercentageExample
} from "@ipmat/question-engine";
import { errorTaxonomySeed } from "../seed-data/errorTaxonomy.js";

// Prisma's Json input type wants a plain InputJsonObject; our domain
// packages export strongly-typed interfaces instead. This is a type-level
// impedance mismatch at the Prisma boundary only — the runtime value is
// already plain, serializable data.
const asJson = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;

const prisma = new PrismaClient();

/**
 * The Quant chapter catalog for IPMAT Indore. Only "Percentages" (and its
 * immediate neighborhood) gets a concept graph / taxonomy / questions in
 * this vertical slice — the rest exist as rows because exam structure is
 * data (docs/DATABASE.md), not because they're being built out now (see
 * docs/MASTER_PLAN.md "What should explicitly NOT be built yet").
 * "Mixtures and Alligations" is new in Phase 2 — added because the
 * Percentages neighborhood graph legitimately reaches it (docs/QUESTION_
 * ENGINE.md §1), the same reasoning that justified the original list.
 */
const QUANT_CHAPTERS = [
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

  // Each concept in the neighborhood graph lives under ITS OWN chapter
  // (docs/QUESTION_ENGINE.md §1) — Percentages is a node in a larger
  // network, not the sole owner of every concept that relates to it.
  const conceptsByName = new Map<string, { id: string }>();
  for (const node of percentagesConceptGraph.concepts) {
    const chapter = chaptersByName.get(node.chapterName);
    if (!chapter) {
      throw new Error(`Concept "${node.name}" references unseeded chapter "${node.chapterName}"`);
    }
    const concept = await prisma.concept.upsert({
      where: { chapterId_name: { chapterId: chapter.id, name: node.name } },
      update: { description: node.description, status: node.status },
      create: {
        chapterId: chapter.id,
        name: node.name,
        description: node.description,
        status: node.status
      }
    });
    conceptsByName.set(node.name, concept);
  }

  const requireConcept = (name: string): { id: string } => {
    const concept = conceptsByName.get(name);
    if (!concept) throw new Error(`Unseeded concept referenced: "${name}"`);
    return concept;
  };

  for (const edge of percentagesConceptGraph.relations) {
    const fromConcept = requireConcept(edge.from);
    const toConcept = requireConcept(edge.to);
    await prisma.conceptRelation.upsert({
      where: {
        fromConceptId_toConceptId_type: {
          fromConceptId: fromConcept.id,
          toConceptId: toConcept.id,
          type: edge.type
        }
      },
      update: {
        rationale: edge.rationale,
        sharedKnowledge: edge.sharedKnowledge,
        usefulForQuestionGeneration: edge.usefulForQuestionGeneration,
        requirementLevel: edge.requirementLevel,
        certainty: edge.certainty,
        source: edge.source
      },
      create: {
        fromConceptId: fromConcept.id,
        toConceptId: toConcept.id,
        type: edge.type,
        rationale: edge.rationale,
        sharedKnowledge: edge.sharedKnowledge,
        usefulForQuestionGeneration: edge.usefulForQuestionGeneration,
        requirementLevel: edge.requirementLevel,
        certainty: edge.certainty,
        source: edge.source
      }
    });
  }

  for (const [name, depth] of [
    ["Percentages", percentagesConceptDepth],
    ["Ratio", ratioConceptDepth]
  ] as const) {
    const concept = requireConcept(name);
    await prisma.conceptDepth.upsert({
      where: { conceptId: concept.id },
      update: {
        definition: depth.definition,
        intuition: depth.intuition,
        formulas: asJson(depth.formulas),
        methods: asJson(depth.methods),
        alternativeMethods: asJson(depth.alternativeMethods),
        shortcuts: asJson(depth.shortcuts),
        commonMisconceptions: asJson(depth.commonMisconceptions),
        commonTraps: asJson(depth.commonTraps),
        applicationAreas: asJson(depth.applicationAreas),
        difficultyProgression: asJson(depth.difficultyProgression)
      },
      create: {
        conceptId: concept.id,
        definition: depth.definition,
        intuition: depth.intuition,
        formulas: asJson(depth.formulas),
        methods: asJson(depth.methods),
        alternativeMethods: asJson(depth.alternativeMethods),
        shortcuts: asJson(depth.shortcuts),
        commonMisconceptions: asJson(depth.commonMisconceptions),
        commonTraps: asJson(depth.commonTraps),
        applicationAreas: asJson(depth.applicationAreas),
        difficultyProgression: asJson(depth.difficultyProgression),
        status: "curated"
      }
    });
  }

  const errorTaxonomyByCode = new Map<string, { id: string }>();
  for (const entry of errorTaxonomySeed) {
    const row = await prisma.errorTaxonomy.upsert({
      where: { code: entry.code },
      update: { label: entry.label, description: entry.description, category: entry.category },
      create: entry
    });
    errorTaxonomyByCode.set(entry.code, row);
  }

  // --- Examiner Lens (docs/QUESTION_ENGINE.md §2) ---
  const percentagesConcept = requireConcept("Percentages");
  const lensPrerequisite = percentagesLens.whatIsTested.prerequisite
    ? requireConcept(percentagesLens.whatIsTested.prerequisite)
    : null;

  const lensAnalysis = await prisma.examinerLensAnalysis.upsert({
    where: { conceptId_version: { conceptId: percentagesConcept.id, version: percentagesLens.version } },
    update: {},
    create: {
      conceptId: percentagesConcept.id,
      version: percentagesLens.version,
      whatIsTestedConcept: percentagesLens.whatIsTested.concept,
      whatIsTestedSubconcept: percentagesLens.whatIsTested.subconcept,
      whatIsTestedSkill: percentagesLens.whatIsTested.skill,
      whatIsTestedPrerequisiteId: lensPrerequisite?.id ?? null,
      testingModes: percentagesLens.testingModes,
      errorModes: asJson(percentagesLens.errorModes),
      difficultyDimensions: asJson(percentagesLens.difficultyDimensions),
      authoredBy: "human",
      status: percentagesLens.status
    }
  });

  // --- Question Pattern Families (docs/QUESTION_ENGINE.md §3) ---
  const patternFamiliesByName = new Map<string, { id: string }>();
  for (const family of percentagesPatternFamilies) {
    const concept = requireConcept(family.conceptName);
    const row = await prisma.questionPatternFamily.upsert({
      where: { conceptId_name: { conceptId: concept.id, name: family.name } },
      update: {},
      create: {
        conceptId: concept.id,
        examinerLensAnalysisId: lensAnalysis.id,
        name: family.name,
        skill: family.skill,
        description: family.description,
        expectedDifficultyTier: family.expectedDifficultyTier,
        potentialCombinationConceptIds: family.potentialCombinationConcepts.map((n) => requireConcept(n).id),
        potentialTrapErrorTaxonomyIds: family.potentialTrapErrorTaxonomyCodes.map((code) => {
          const entry = errorTaxonomyByCode.get(code);
          if (!entry) throw new Error(`Unseeded error taxonomy code referenced: "${code}"`);
          return entry.id;
        }),
        potentialTestingModes: family.potentialTestingModes,
        status: family.status
      }
    });
    patternFamiliesByName.set(family.name, row);
  }

  // --- Pattern Taxonomy Cells (docs/QUESTION_ENGINE.md §3, §6) ---
  const cellRecords: { id: string }[] = [];
  for (const cell of percentagesTaxonomyCells) {
    const concept = requireConcept(cell.conceptName);
    const family = patternFamiliesByName.get(cell.patternFamilyName);
    if (!family) throw new Error(`Unseeded pattern family referenced: "${cell.patternFamilyName}"`);
    const trapId = cell.trapErrorTaxonomyCode ? errorTaxonomyByCode.get(cell.trapErrorTaxonomyCode)?.id ?? null : null;

    // Plain find-then-create/update rather than `upsert`: the natural key
    // includes nullable columns (testingMode, trapErrorTaxonomyId), and
    // Prisma's generated compound-unique `where` input does not accept
    // null for those fields even though the underlying Postgres unique
    // index does (Postgres treats each NULL as distinct). A regular
    // `findFirst` filter has no such restriction.
    const existingCell = await prisma.patternTaxonomyCell.findFirst({
      where: {
        conceptId: concept.id,
        patternFamilyId: family.id,
        testingMode: cell.testingMode,
        trapErrorTaxonomyId: trapId,
        difficultyTier: cell.difficultyTier
      }
    });
    const cellData = {
      conceptId: concept.id,
      examinerLensAnalysisId: lensAnalysis.id,
      patternFamilyId: family.id,
      combination: cell.combination.map((n) => requireConcept(n).id),
      testingMode: cell.testingMode,
      trapErrorTaxonomyId: trapId,
      difficultyTier: cell.difficultyTier,
      targetTimeSeconds: cell.targetTimeSeconds,
      coverageStatus: cell.coverageStatus
    };
    const row = existingCell
      ? await prisma.patternTaxonomyCell.update({
          where: { id: existingCell.id },
          data: { coverageStatus: cell.coverageStatus }
        })
      : await prisma.patternTaxonomyCell.create({ data: cellData });
    cellRecords.push(row);
  }

  // --- The one demonstration question (docs/MASTER_PLAN.md Phase 2 §12) ---
  const demoCellIndex = percentagesTaxonomyCells.findIndex((cell) => cell.coverageStatus === "covered");
  if (demoCellIndex === -1) {
    throw new Error("No taxonomy cell is marked 'covered' for the demonstration question to attach to");
  }
  const demoCell = cellRecords[demoCellIndex]!;
  const { dna, content } = percentagesReversePercentageExample;

  const provenance = await prisma.provenance.upsert({
    where: { id: "00000000-0000-0000-0000-000000000001" },
    update: {},
    create: {
      id: "00000000-0000-0000-0000-000000000001",
      sourceType: dna.provenanceSourceType,
      sourceRef: "phase-2-demonstration",
      attributedTo: "IPMAT AI Prep (original)"
    }
  });

  await prisma.question.upsert({
    where: { id: "00000000-0000-0000-0000-000000000002" },
    update: {},
    create: {
      id: "00000000-0000-0000-0000-000000000002",
      examId: exam.id,
      sectionId: quant.id,
      chapterId: percentagesChapter.id,
      conceptId: requireConcept(dna.conceptName).id,
      subconcepts: dna.subconcepts.map((n) => requireConcept(n).id),
      prerequisites: dna.prerequisites.map((n) => requireConcept(n).id),
      combinesWithConceptIds: dna.combinesWithConcepts.map((n) => requireConcept(n).id),
      patternTaxonomyCellId: demoCell.id,
      skill: dna.skill,
      difficultyTier: dna.difficultyTier,
      difficultyDimensions: asJson(dna.difficultyDimensions),
      noveltyLevel: dna.noveltyLevel,
      examRelevance: dna.examRelevance,
      expectedTimeSeconds: dna.expectedTimeSeconds,
      testingModes: dna.testingModes,
      trapErrorTaxonomyId: dna.trapErrorTaxonomyCode ? errorTaxonomyByCode.get(dna.trapErrorTaxonomyCode)?.id : null,
      body: content.body,
      options: asJson(content.options),
      correctAnswer: content.correctAnswer,
      solutionSteps: asJson(content.solutionSteps),
      groundTruthDerivation: asJson(content.groundTruthDerivation),
      validationState: dna.validationState,
      provenanceId: provenance.id
    }
  });

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
  console.log(`  Chapters: ${QUANT_CHAPTERS.length}`);
  console.log(`  Concepts: ${conceptsByName.size}`);
  console.log(`  Concept relations: ${percentagesConceptGraph.relations.length}`);
  console.log(`  Concept depth entries: 2`);
  console.log(`  Error taxonomy entries: ${errorTaxonomySeed.length}`);
  console.log(`  Examiner Lens analyses: 1`);
  console.log(`  Question pattern families: ${patternFamiliesByName.size}`);
  console.log(`  Pattern taxonomy cells: ${cellRecords.length}`);
  console.log(`  Demonstration questions: 1`);
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
