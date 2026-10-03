import {
  InMemorySimulationRepository,
  SimulationService,
  type AnswerKey,
  type PaperCandidate,
  type PaperSelection,
  type SimulationConfig,
  type SimulationConfigSource,
  type SimulationDefinition,
  type SimulationEnrollment,
  type SimulationEnrollmentReader,
  type SimulationQuestionContent,
  type SimulationQuestionSource
} from "../src/index.js";

/**
 * FIXTURE DATA. Every value below (durations, section names, question counts) is a labelled TEST fixture used to exercise
 * the engine's mechanics. None is an IPMAT rule and none is presented as one: the repository specifies no exam rule.
 */
export const EXAM = "FIXTURE_EXAM";
export const T0 = "2026-10-03T10:00:00.000Z";
export const DURATION = 600; // fixture: 10 minutes
export const STUDENT = "student-1";
export const ENROLLMENT = "enrollment-1";

export const fixtureConfig = (over: Partial<SimulationConfig> = {}): SimulationConfig => ({
  examCode: EXAM,
  configVersion: "fixture-v1",
  overallDurationSeconds: DURATION,
  sections: [
    { sectionName: "Section B", order: 2, questionCount: 1 },
    { sectionName: "Section A", order: 1, questionCount: 2 }
  ],
  provenance: { kind: "authored", sourceRef: "fixture:test-configuration (not an exam rule)", reviewState: "unvalidated", reviewedBy: null, note: "TEST DATA" },
  ...over
});

export const fixtureSelection = (over: Partial<PaperSelection> = {}): PaperSelection => ({
  origin: "assembled",
  sourceRef: "fixture:assembled-paper",
  sections: { "Section A": ["qa1", "qa2"], "Section B": ["qb1"] },
  ...over
});

export const KEYS: Record<string, string> = { qa1: "11", qa2: "22", qb1: "33" };
const OPTIONS: Record<string, string[] | null> = { qa1: ["10", "11", "12"], qa2: ["22", "23"], qb1: null };

export function candidates(over: Partial<PaperCandidate>[] = []): PaperCandidate[] {
  const base: PaperCandidate[] = [
    { questionId: "qa1", examCode: EXAM, sectionName: "Section A", validationState: "published", sourceType: "original", contentFingerprint: "fp-qa1" },
    { questionId: "qa2", examCode: EXAM, sectionName: "Section A", validationState: "published", sourceType: "original", contentFingerprint: "fp-qa2" },
    { questionId: "qb1", examCode: EXAM, sectionName: "Section B", validationState: "published", sourceType: "licensed", contentFingerprint: "fp-qb1" }
  ];
  return base.map((c) => ({ ...c, ...(over.find((o) => o.questionId === c.questionId) ?? {}) }));
}

/** Mutable question world: tests can unpublish, edit (change fingerprint) or add questions. */
export class FakeQuestions implements SimulationQuestionSource {
  pool: PaperCandidate[] = candidates();
  fingerprintOverride: Record<string, string> = {};
  unpublished = new Set<string>();
  answerKeyReads = 0;
  contentReads = 0;
  async findPaperCandidates(examCode: string, ids: readonly string[]): Promise<PaperCandidate[]> {
    return this.pool.filter((c) => c.examCode === examCode && ids.includes(c.questionId));
  }
  async findPublishedContent(examCode: string, ids: readonly string[]): Promise<SimulationQuestionContent[]> {
    this.contentReads += 1;
    return this.pool
      .filter((c) => c.examCode === examCode && ids.includes(c.questionId) && c.validationState === "published" && !this.unpublished.has(c.questionId))
      .map((c) => ({ questionId: c.questionId, prompt: `Prompt of ${c.questionId}`, answerFormat: OPTIONS[c.questionId] ? "multiple_choice" : "numeric_entry", options: OPTIONS[c.questionId] ?? null, contentFingerprint: this.fingerprintOverride[c.questionId] ?? c.contentFingerprint }));
  }
  async findAnswerKeys(ids: readonly string[]): Promise<AnswerKey> {
    this.answerKeyReads += 1;
    const out: Record<string, { correctAnswer: string; contentFingerprint: string }> = {};
    for (const id of ids) {
      const c = this.pool.find((x) => x.questionId === id);
      if (c) out[id] = { correctAnswer: KEYS[id]!, contentFingerprint: this.fingerprintOverride[id] ?? c.contentFingerprint };
    }
    return out;
  }
}

export class FakeEnrollments implements SimulationEnrollmentReader {
  rows: SimulationEnrollment[] = [
    { id: ENROLLMENT, studentId: STUDENT, examCode: EXAM },
    { id: "enrollment-2", studentId: "student-2", examCode: EXAM },
    { id: "enrollment-other-exam", studentId: STUDENT, examCode: "OTHER_EXAM" }
  ];
  async findById(id: string): Promise<SimulationEnrollment | null> {
    return this.rows.find((r) => r.id === id) ?? null;
  }
}

export class FakeConfigs implements SimulationConfigSource {
  definition: SimulationDefinition | null = { config: fixtureConfig(), selection: fixtureSelection() };
  async findDefinition(examCode: string): Promise<SimulationDefinition | null> {
    return this.definition && this.definition.config.examCode === examCode ? this.definition : null;
  }
}

/** A controllable server clock. */
export class Clock {
  constructor(public current: string = T0) {}
  now = (): string => this.current;
  set(iso: string): void {
    this.current = iso;
  }
  /** Moves to `ms` after T0. */
  at(ms: number): void {
    this.current = new Date(Date.parse(T0) + ms).toISOString();
  }
}

export function world(): { service: SimulationService; repo: InMemorySimulationRepository; clock: Clock; questions: FakeQuestions; configs: FakeConfigs; enrollments: FakeEnrollments } {
  const repo = new InMemorySimulationRepository();
  const clock = new Clock();
  const questions = new FakeQuestions();
  const configs = new FakeConfigs();
  const enrollments = new FakeEnrollments();
  let n = 0;
  const service = new SimulationService({ enrollments, configs, questions, repository: repo, now: clock.now, newId: () => `sim-${++n}` });
  return { service, repo, clock, questions, configs, enrollments };
}

export const REQ = { studentId: STUDENT, enrollmentId: ENROLLMENT };
