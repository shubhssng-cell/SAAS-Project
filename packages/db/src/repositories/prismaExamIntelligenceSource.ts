import { createHash } from "node:crypto";
import { computeContentFingerprint, type QuestionInstanceDna } from "@ipmat/content-authoring";
import { ExamIntelligenceError, type ContentQuestionView, type ExamIntelligenceSnapshot, type ExamIntelligenceSource, type OutcomeSource, type QuestionOutcome } from "@ipmat/exam-intelligence";
import type { DifficultyDimensions } from "@ipmat/examiner-lens";
import type { QuestionPatternFamilyData } from "@ipmat/question-engine";
import type { PrismaClient } from "@prisma/client";
import { PrismaExamPackRepository } from "./prismaExamPackRepository.js";
import { PrismaHistoricalRecordRepository } from "./prismaHistoricalRecordRepository.js";

/**
 * The database-backed `ExamIntelligenceSource` and `OutcomeSource`
 * (docs/DECISIONS.md D-086). Read-only; no migration was needed.
 *
 * Assembles ONE exam's snapshot from the existing tables: the pack, the mapped
 * pattern families, the content questions (DNA + lifecycle + provenance KIND +
 * a content fingerprint computed on read for duplicate detection) and the
 * historical records. It uses `select` throughout and NEVER selects
 * `correctAnswer`, `solutionSteps`, `groundTruthDerivation`, reviewer columns
 * or provenance references into what it returns: the question text is read only
 * to compute the fingerprint and is dropped immediately. Every query is scoped by
 * the exam code, so another exam's rows can never enter a snapshot.
 *
 * Outcomes are graded, finalized attempts reduced to (question, time, correct)
 * plus an OPAQUE one-way student key used only to count distinct students; the
 * student id itself is never returned.
 */
export class PrismaExamIntelligenceSource implements ExamIntelligenceSource {
  constructor(private readonly prisma: PrismaClient) {}

  async loadSnapshot(examCode: string): Promise<ExamIntelligenceSnapshot> {
    const pack = await new PrismaExamPackRepository(this.prisma).findByExamCode(examCode);
    if (!pack) throw new ExamIntelligenceError("exam_mismatch", `no exam "${examCode}"`);

    const conceptRows = await this.prisma.concept.findMany({ where: { chapter: { section: { exam: { code: examCode } } } }, select: { id: true, name: true } });
    const conceptName = new Map(conceptRows.map((c) => [c.id, c.name]));
    const trapRows = await this.prisma.errorTaxonomy.findMany({ select: { id: true, code: true }, orderBy: { code: "asc" } });
    const trapCode = new Map(trapRows.map((t) => [t.id, t.code]));

    const familyRows = await this.prisma.questionPatternFamily.findMany({
      where: { concept: { chapter: { section: { exam: { code: examCode } } } } },
      orderBy: [{ conceptId: "asc" }, { name: "asc" }],
      select: { name: true, skill: true, description: true, expectedDifficultyTier: true, potentialCombinationConceptIds: true, potentialTrapErrorTaxonomyIds: true, potentialTestingModes: true, status: true, concept: { select: { name: true } } }
    });
    const patternFamilies: QuestionPatternFamilyData[] = familyRows.map((f) => ({
      name: f.name,
      conceptName: f.concept.name,
      skill: f.skill,
      description: f.description,
      expectedDifficultyTier: f.expectedDifficultyTier,
      potentialCombinationConcepts: f.potentialCombinationConceptIds.flatMap((id) => (conceptName.has(id) ? [conceptName.get(id)!] : [])),
      potentialTrapErrorTaxonomyCodes: f.potentialTrapErrorTaxonomyIds.flatMap((id) => (trapCode.has(id) ? [trapCode.get(id)!] : [])),
      potentialTestingModes: f.potentialTestingModes,
      status: f.status
    }));

    const rows = await this.prisma.question.findMany({
      where: { exam: { code: examCode } },
      orderBy: { id: "asc" },
      select: {
        id: true,
        validationState: true,
        body: true,
        options: true,
        skill: true,
        difficultyTier: true,
        difficultyDimensions: true,
        noveltyLevel: true,
        examRelevance: true,
        expectedTimeSeconds: true,
        testingModes: true,
        subconcepts: true,
        prerequisites: true,
        combinesWithConceptIds: true,
        exam: { select: { code: true } },
        section: { select: { name: true } },
        chapter: { select: { name: true } },
        concept: { select: { name: true } },
        patternTaxonomyCell: { select: { patternFamily: { select: { name: true } } } },
        trapErrorTaxonomy: { select: { code: true } },
        provenance: { select: { sourceType: true, sourceRef: true } }
      }
    });
    const nameOf = (id: string): string => conceptName.get(id) ?? `unresolved:${id}`;
    const questions: ContentQuestionView[] = rows.map((r) => {
      const options = Array.isArray(r.options) ? r.options.map(String) : [];
      const dna: QuestionInstanceDna = {
        examCode: r.exam.code,
        sectionName: r.section.name,
        chapterName: r.chapter.name,
        conceptName: r.concept.name,
        subconcepts: r.subconcepts.map(nameOf),
        prerequisites: r.prerequisites.map(nameOf),
        combinesWithConcepts: r.combinesWithConceptIds.map(nameOf),
        patternFamilyName: r.patternTaxonomyCell.patternFamily.name,
        skill: r.skill,
        difficultyTier: r.difficultyTier,
        difficultyDimensions: r.difficultyDimensions as unknown as DifficultyDimensions,
        noveltyLevel: r.noveltyLevel,
        examRelevance: r.examRelevance,
        expectedTimeSeconds: r.expectedTimeSeconds,
        testingModes: r.testingModes,
        trapErrorTaxonomyCode: r.trapErrorTaxonomy?.code ?? null
      };
      return {
        id: r.id,
        dna,
        validationState: r.validationState,
        sourceType: r.provenance?.sourceType ?? null,
        // The question text is used ONLY to compute this fingerprint and is not retained.
        fingerprint: computeContentFingerprint(examCode, r.body, options),
        isFixture: (r.provenance?.sourceRef ?? "").startsWith("fixture:") || r.body.startsWith("[TEST DATA")
      };
    });

    const historicalRecords = await new PrismaHistoricalRecordRepository(this.prisma).listByExamCode(examCode);
    return { examCode, examVersion: pack.packVersion, pack, patternFamilies, errorTaxonomyCodes: trapRows.map((t) => t.code), questions, historicalRecords };
  }
}

export class PrismaOutcomeSource implements OutcomeSource {
  constructor(private readonly prisma: PrismaClient) {}

  async loadOutcomes(examCode: string): Promise<QuestionOutcome[]> {
    const rows = await this.prisma.attempt.findMany({
      where: { status: "submitted", isCorrect: { not: null }, question: { exam: { code: examCode } } },
      orderBy: { id: "asc" },
      select: { questionId: true, studentId: true, timeSpentSeconds: true, isCorrect: true }
    });
    return rows.map((r) => ({
      questionId: r.questionId,
      // One-way and exam-scoped: counts distinct students without ever exposing (or being joinable to) a student id.
      studentKey: createHash("sha256").update(`${examCode}|${r.studentId}`).digest("hex").slice(0, 24),
      timeSpentSeconds: r.timeSpentSeconds,
      isCorrect: r.isCorrect
    }));
  }
}
