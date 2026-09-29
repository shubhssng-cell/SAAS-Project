import type { AuthApiDependencies } from "@ipmat/auth-api";
import type { PrismaClient } from "@prisma/client";
import {
  InMemoryAttemptRepository,
  InMemoryEnrollmentReader,
  InMemoryQuestionContentReader,
  InMemoryQuestionReader,
  InMemorySessionRepository,
  InMemoryStudentAccountRepository,
  PrismaAttemptRepository,
  PrismaAutopsyRepository,
  PrismaConceptReader,
  PrismaEnrollmentReader,
  PrismaPracticeBlockRepository,
  PrismaPracticeSessionRepository,
  PrismaQuestionContentReader,
  PrismaQuestionReader,
  PrismaRepairPlanRepository,
  PrismaSessionRepository,
  PrismaStudentAccountRepository,
  PrismaTrainingQuestionReader,
  type AutopsyRepository
} from "@ipmat/db";
import { PracticeLoopService } from "@ipmat/practice-loop";
import type { PracticeApiDependencies } from "@ipmat/practice-api";
import { TrainingRecommendationService, type TrainingRecommendationDependencies } from "@ipmat/training-recommendation";

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
 * data of its own; a caller (a test, a future demo script) seeds whatever
 * it needs directly against the returned repository instances.
 */
export function createInMemoryDependencies(
  seed: { enrollments?: ConstructorParameters<typeof InMemoryEnrollmentReader>[0]; questions?: ConstructorParameters<typeof InMemoryQuestionReader>[0]; questionContent?: ConstructorParameters<typeof InMemoryQuestionContentReader>[0] } = {}
): PracticeApiDependencies &
  AuthApiDependencies & {
    attempts: InMemoryAttemptRepository;
    enrollments: InMemoryEnrollmentReader;
    questions: InMemoryQuestionReader;
    questionContent: InMemoryQuestionContentReader;
  } {
  const attempts = new InMemoryAttemptRepository();
  const enrollments = new InMemoryEnrollmentReader(seed.enrollments);
  const questions = new InMemoryQuestionReader(seed.questions);
  const questionContent = new InMemoryQuestionContentReader(seed.questionContent);
  const autopsyReader: Pick<AutopsyRepository, "findByAttemptId"> = { findByAttemptId: async () => null };
  const studentAccounts = new InMemoryStudentAccountRepository();
  const sessions = new InMemorySessionRepository();

  const trainingRecommendationDeps: TrainingRecommendationDependencies = {
    enrollmentReader: enrollments,
    attemptHistoryReader: attempts,
    repairPlanReader: { findConfirmedActiveByStudentId: async () => [] },
    trainingQuestionReader: { findPublishedByExamId: async () => [] },
    questionReader: questions,
    conceptReader: { findWithPublishedQuestionsByExamId: async () => [] },
    practiceSessionReader: { findActiveByEnrollmentId: async () => null },
    practiceBlockReader: { findBySessionId: async () => [] }
  };

  return {
    trainingRecommendationService: new TrainingRecommendationService(trainingRecommendationDeps),
    practiceLoopService: new PracticeLoopService(attempts, questions),
    enrollmentReader: enrollments,
    questionReader: questions,
    questionContentReader: questionContent,
    autopsyReader,
    studentAccounts,
    sessions,
    attempts,
    enrollments,
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
export function createPrismaDependencies(prisma: PrismaClient): PracticeApiDependencies & AuthApiDependencies {
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
    sessions: new PrismaSessionRepository(prisma)
  };
}
