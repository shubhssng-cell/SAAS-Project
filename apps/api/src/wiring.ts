import type { AuthApiDependencies } from "@ipmat/auth-api";
import type { EnrollmentApiDependencies } from "@ipmat/enrollment-api";
import type { PrismaClient } from "@prisma/client";
import {
  InMemoryAttemptRepository,
  InMemoryEnrollmentRepository,
  InMemoryConceptReader,
  InMemoryExamReader,
  InMemoryPrepPhaseTemplateReader,
  InMemoryQuestionContentReader,
  InMemoryQuestionReader,
  InMemorySessionRepository,
  InMemoryStudentAccountRepository,
  InMemoryTrainingQuestionReader,
  PrismaAttemptRepository,
  PrismaAutopsyRepository,
  PrismaConceptReader,
  PrismaEnrollmentReader,
  PrismaEnrollmentRepository,
  PrismaExamReader,
  PrismaPracticeBlockRepository,
  PrismaPracticeSessionRepository,
  PrismaPrepPhaseTemplateReader,
  PrismaQuestionContentReader,
  PrismaQuestionReader,
  PrismaRepairPlanRepository,
  PrismaSessionRepository,
  PrismaStudentAccountRepository,
  PrismaTrainingQuestionReader,
  type AutopsyRepository,
  type ConceptRecord,
  type EnrollmentReader,
  type ExamRecord,
  type PrepPhaseTemplateRecord,
  type TrainingQuestionRecord
} from "@ipmat/db";
import { ipmatPrepPhaseTemplate } from "@ipmat/prep-phase";
import { PracticeLoopService } from "@ipmat/practice-loop";
import type { PracticeApiDependencies } from "@ipmat/practice-api";
import { TrainingRecommendationService, type TrainingRecommendationDependencies } from "@ipmat/training-recommendation";

/**
 * Product Phase 1 Unit 7 (IPMAT Enrollment) -- the in-memory wiring's
 * default seed for `ExamReader`/`PrepPhaseTemplateReader`. Mirrors the
 * REAL seeded data exactly (`packages/db/prisma/seed.ts`'s `IPMAT_INDORE`
 * exam, `@ipmat/prep-phase`'s own `ipmatPrepPhaseTemplate` fixture) --
 * never invented values. The in-memory id is arbitrary (no live database
 * exists to match a real row's uuid); `EnrollmentApiService` only ever
 * resolves the exam by its CODE, never by this id directly.
 */
const DEFAULT_EXAM_ID = "exam-ipmat-indore";
const DEFAULT_EXAM: ExamRecord = { id: DEFAULT_EXAM_ID, code: "IPMAT_INDORE", examDateRule: { type: "fixed_date", date: ipmatPrepPhaseTemplate.examDate } };
const DEFAULT_PREP_PHASE_TEMPLATE: PrepPhaseTemplateRecord = { examId: DEFAULT_EXAM_ID, phaseCurve: ipmatPrepPhaseTemplate.phaseCurve };

/**
 * The ONE place `@ipmat/practice-api`'s port interfaces are wired to
 * concrete implementations (I). Two wirings are provided; neither is
 * chosen automatically by anything other than `src/index.ts`'s own
 * explicit call — this file itself never reads `process.env` or connects
 * to anything.
 */

/**
 * In-memory wiring — the ONLY wiring this unit's own entry point actually
 * runs (`src/index.ts`), since no live database has ever been reachable
 * in this environment (docs/project-memory/72_DATABASE_AND_INFRASTRUCTURE.md).
 * Every store starts genuinely empty — this function seeds no fixture
 * data of its own; a caller seeds whatever it needs via the `seed`
 * parameter. `src/index.ts` seeds the development content set from
 * `devContent.ts` (Phase 2 Unit 1); a test passes its own or nothing.
 */
export function createInMemoryDependencies(
  seed: {
    questions?: ConstructorParameters<typeof InMemoryQuestionReader>[0];
    questionContent?: ConstructorParameters<typeof InMemoryQuestionContentReader>[0];
    exams?: ExamRecord[];
    prepPhaseTemplates?: PrepPhaseTemplateRecord[];
    /** Phase 2 Unit 1: published training-question / concept read models, keyed by exam id (see `devContent.ts`). Empty by default. */
    trainingQuestions?: ReadonlyMap<string, TrainingQuestionRecord[]>;
    concepts?: ReadonlyMap<string, ConceptRecord[]>;
  } = {}
): PracticeApiDependencies &
  AuthApiDependencies &
  EnrollmentApiDependencies & {
    attempts: InMemoryAttemptRepository;
    questions: InMemoryQuestionReader;
    questionContent: InMemoryQuestionContentReader;
  } {
  const attempts = new InMemoryAttemptRepository();
  const questions = new InMemoryQuestionReader(seed.questions);
  const questionContent = new InMemoryQuestionContentReader(seed.questionContent);
  const autopsyReader: Pick<AutopsyRepository, "findByAttemptId"> = { findByAttemptId: async () => null };
  const studentAccounts = new InMemoryStudentAccountRepository();
  const sessions = new InMemorySessionRepository();
  const enrollmentRepository = new InMemoryEnrollmentRepository();
  const examReader = new InMemoryExamReader(seed.exams ?? [DEFAULT_EXAM]);
  const prepPhaseTemplateReader = new InMemoryPrepPhaseTemplateReader(seed.prepPhaseTemplates ?? [DEFAULT_PREP_PHASE_TEMPLATE]);

  /**
   * Product Phase 1 Unit 10 -- reads through the SAME `enrollmentRepository`
   * instance `/v1/enrollment` writes to, rather than a second, disconnected
   * `InMemoryEnrollmentReader` store (the pre-Unit-10 shape: correct for
   * Units 1-9, where nothing yet exercised enrollment ownership and
   * real practice through one continuous in-memory wiring, but a genuine
   * bug the first real end-to-end run under this unit surfaced -- an
   * enrollment created via `POST /v1/enrollment` was invisible to
   * `assertEnrollmentOwnership()`/`TrainingRecommendationService`, both of
   * which read via `EnrollmentReader`). `StudentEnrollmentRecord` already
   * structurally contains every `EnrollmentRecord` field plus `enrolledAt`
   * -- this is a narrowing read, not a new store or a schema change.
   */
  const enrollmentReader: EnrollmentReader = {
    findById: async (enrollmentId) => {
      const record = await enrollmentRepository.findById(enrollmentId);
      return record ? { id: record.id, studentId: record.studentId, examId: record.examId } : null;
    }
  };

  const trainingRecommendationDeps: TrainingRecommendationDependencies = {
    enrollmentReader,
    attemptHistoryReader: attempts,
    repairPlanReader: { findConfirmedActiveByStudentId: async () => [] },
    trainingQuestionReader: new InMemoryTrainingQuestionReader(seed.trainingQuestions),
    questionReader: questions,
    conceptReader: new InMemoryConceptReader(seed.concepts),
    practiceSessionReader: { findActiveByEnrollmentId: async () => null },
    practiceBlockReader: { findBySessionId: async () => [] }
  };

  return {
    trainingRecommendationService: new TrainingRecommendationService(trainingRecommendationDeps),
    practiceLoopService: new PracticeLoopService(attempts, questions),
    enrollmentReader,
    questionReader: questions,
    questionContentReader: questionContent,
    autopsyReader,
    studentAccounts,
    sessions,
    enrollments: enrollmentRepository,
    examReader,
    prepPhaseTemplateReader,
    attempts,
    questions,
    questionContent
  };
}

/**
 * Prisma-backed wiring — structurally complete, NEVER invoked by
 * `src/index.ts` or exercised against a live database in this unit (J, I:
 * "do not invent a production database deployment"). Provided so a future
 * unit, once a real Postgres instance is reachable, has this wiring ready
 * without needing to re-derive it — the same "correct by construction,
 * never yet run against a live database" stance every `PrismaXRepository`
 * in this codebase already has.
 *
 * `RepairPlanRepository`/`TrainingQuestionReader`/`ConceptReader`/
 * `PracticeSessionRepository`/`PracticeBlockRepository` are the SAME ports
 * `@ipmat/training-recommendation` already requires (D-063) — constructed
 * here identically, never a second, competing construction.
 */
export function createPrismaDependencies(prisma: PrismaClient): PracticeApiDependencies & AuthApiDependencies & EnrollmentApiDependencies {
  const attempts = new PrismaAttemptRepository(prisma);
  const enrollmentReader = new PrismaEnrollmentReader(prisma);
  const questionReader = new PrismaQuestionReader(prisma);

  const trainingRecommendationDeps: TrainingRecommendationDependencies = {
    enrollmentReader,
    attemptHistoryReader: attempts,
    repairPlanReader: new PrismaRepairPlanRepository(prisma),
    trainingQuestionReader: new PrismaTrainingQuestionReader(prisma),
    questionReader,
    conceptReader: new PrismaConceptReader(prisma),
    practiceSessionReader: new PrismaPracticeSessionRepository(prisma),
    practiceBlockReader: new PrismaPracticeBlockRepository(prisma)
  };

  return {
    trainingRecommendationService: new TrainingRecommendationService(trainingRecommendationDeps),
    practiceLoopService: new PracticeLoopService(attempts, questionReader),
    enrollmentReader,
    questionReader,
    questionContentReader: new PrismaQuestionContentReader(prisma),
    autopsyReader: new PrismaAutopsyRepository(prisma),
    studentAccounts: new PrismaStudentAccountRepository(prisma),
    sessions: new PrismaSessionRepository(prisma),
    enrollments: new PrismaEnrollmentRepository(prisma),
    examReader: new PrismaExamReader(prisma),
    prepPhaseTemplateReader: new PrismaPrepPhaseTemplateReader(prisma)
  };
}
