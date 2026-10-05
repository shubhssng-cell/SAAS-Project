import { percentagesConceptGraph } from "@ipmat/concept-graph";
import type { AiCompletion, AiProvider } from "@ipmat/ai";
import {
  createTutorService,
  type TutorAttemptRecord,
  type TutorAuditEntry,
  type TutorContextDeps,
  type TutorQuestionRecord,
  type TutorRequest,
  type TutorServiceDeps,
  type TutorSourceItem
} from "../src/index.js";

/**
 * EVERYTHING here is a labelled TEST FIXTURE: synthetic questions, students and
 * model outputs invented for these tests. No live model is ever called.
 */

export const STUDENT_A = "11111111-aaaa-4aaa-8aaa-111111111111";
export const STUDENT_B = "22222222-bbbb-4bbb-8bbb-222222222222";
export const ENROLL_A = "33333333-aaaa-4aaa-8aaa-333333333333";
export const ENROLL_B = "44444444-bbbb-4bbb-8bbb-444444444444";
export const ENROLL_A_OTHER_EXAM = "55555555-aaaa-4aaa-8aaa-555555555555";
export const EXAM = "IPMAT_INDORE";
export const OTHER_EXAM = "OTHER_EXAM";

export const QUESTION_ID = "question-pct-1";
export const OTHER_EXAM_QUESTION_ID = "question-other-1";
export const UNPUBLISHED_ID = "question-draft-1";

/** Sentinels that must never reach a prompt or a student view unless a policy says so. */
export const KEY = "₹500";
export const STEP_1 = "Compute the discounted price as 80 percent of the marked price of 625 rupees.";
export const TRAP_CODE = "internal_trap_code_xyz";
export const CELL_ID = "cell-id-9f8e7d6c5b4a";

export const question = (over: Partial<TutorQuestionRecord> = {}): TutorQuestionRecord => ({
  questionId: QUESTION_ID,
  examCode: EXAM,
  validationState: "published",
  conceptName: "Percentages",
  stem: "A shirt marked at 625 rupees is sold at a 20 percent discount. What is the selling price?",
  options: ["₹480", "₹500", "₹450", "₹520"],
  correctAnswer: KEY,
  solutionSteps: [STEP_1, "The selling price is therefore the result of that multiplication."],
  patternFamilyName: "Discount on marked price",
  skill: "Apply a percentage decrease",
  difficultyTier: "standard",
  noveltyLevel: "standard",
  expectedTimeSeconds: 60,
  testingModes: ["direct", "contextualized"],
  trapLabel: "Subtracting the percentage as a flat amount",
  internalTokens: [TRAP_CODE, CELL_ID],
  ...over
});

export const attempt = (over: Partial<TutorAttemptRecord> = {}): TutorAttemptRecord => ({
  attemptId: "attempt-0001-aaaaaaaa",
  studentId: STUDENT_A,
  questionId: QUESTION_ID,
  status: "submitted",
  finalAnswer: "₹480",
  isCorrect: false,
  hintsUsed: 0,
  answerChanges: 1,
  timeTakenSeconds: 75,
  workingSteps: "625 - 20 = 605 then I guessed",
  reasoningText: null,
  ...over
});

export interface World {
  enrollments: Array<{ studentId: string; enrollmentId: string; examCode: string }>;
  questions: TutorQuestionRecord[];
  attempts: TutorAttemptRecord[];
  sources: TutorSourceItem[];
  sourceDenied: boolean;
}

export const world = (over: Partial<World> = {}): World => ({
  enrollments: [
    { studentId: STUDENT_A, enrollmentId: ENROLL_A, examCode: EXAM },
    { studentId: STUDENT_B, enrollmentId: ENROLL_B, examCode: EXAM },
    { studentId: STUDENT_A, enrollmentId: ENROLL_A_OTHER_EXAM, examCode: OTHER_EXAM }
  ],
  questions: [question(), question({ questionId: OTHER_EXAM_QUESTION_ID, examCode: OTHER_EXAM }), question({ questionId: UNPUBLISHED_ID, validationState: "draft" })],
  attempts: [attempt()],
  sources: [],
  sourceDenied: false,
  ...over
});

export function ports(w: World = world()): Required<TutorContextDeps> & { calls: { questions: number; attempts: number; sources: number } } {
  const calls = { questions: 0, attempts: 0, sources: 0 };
  return {
    calls,
    ownership: { resolveEnrollment: async (studentId, enrollmentId) => w.enrollments.find((e) => e.studentId === studentId && e.enrollmentId === enrollmentId) ?? null },
    questions: {
      getQuestion: async (examCode, id) => {
        calls.questions++;
        return w.questions.find((q) => q.questionId === id && q.examCode === examCode) ?? null;
      }
    },
    concepts: { getConceptGraph: async () => percentagesConceptGraph },
    attempts: {
      getLatestAttempt: async (studentId, questionId) => {
        calls.attempts++;
        return w.attempts.find((a) => a.studentId === studentId && a.questionId === questionId) ?? null;
      }
    },
    evidence: { getEvidence: async () => [] },
    sources: {
      retrieve: async (q) => {
        calls.sources++;
        return w.sourceDenied ? { status: "denied" } : { status: "ok", items: w.sources.filter((s) => s.examCode === q.examCode) };
      }
    }
  };
}

/** A model output as raw JSON text. Every field has a safe default so tests override only what they test. */
export const modelJson = (over: Record<string, unknown> = {}): string =>
  JSON.stringify({
    responseType: "explanation",
    text: "The question asks for the price after a percentage decrease.",
    citations: ["question"],
    hypotheses: [],
    relationClaims: [],
    questionQuotes: [],
    missingContext: [],
    ...over
  });

/** Deterministic double: consumes scripted behaviours FIFO and records every prompt it was sent (so tests can inspect them). */
export type Behaviour = string | { throws: Error } | { hangMs: number };
export class ScriptedProvider implements AiProvider {
  readonly name = "scripted";
  readonly model = "scripted-v1";
  readonly prompts: Array<{ systemPrompt: string; userPrompt: string }> = [];
  constructor(private readonly script: Behaviour[]) {}
  async complete(input: { systemPrompt: string; userPrompt: string }): Promise<AiCompletion> {
    this.prompts.push({ systemPrompt: input.systemPrompt, userPrompt: input.userPrompt });
    const next = this.script.shift();
    if (next === undefined) throw new Error("ScriptedProvider: no behaviour left");
    if (typeof next === "string") return { rawText: next, usage: { inputTokens: 10, outputTokens: 5 }, latencyMs: 1 };
    if ("throws" in next) throw next.throws;
    await new Promise((r) => setTimeout(r, next.hangMs));
    return { rawText: modelJson(), usage: null, latencyMs: next.hangMs };
  }
}

export function build(script: Behaviour[], over: { world?: World; service?: Partial<TutorServiceDeps> } = {}) {
  const p = ports(over.world ?? world());
  const provider = new ScriptedProvider(script);
  const audits: TutorAuditEntry[] = [];
  const service = createTutorService({
    ...p,
    provider,
    audit: { record: (e) => void audits.push(e) },
    now: () => new Date("2026-10-06T10:00:00.000Z"),
    newRequestId: () => "req-1",
    // Fast retries inside generateStructured keep the suite quick; production defaults are untouched.
    aiOptions: { maxRetries: 0, timeoutMs: 200 },
    ...over.service
  });
  return { service, provider, audits, ports: p };
}

export const request = (over: Partial<TutorRequest> = {}): TutorRequest => ({
  intent: "explain_mistake",
  studentId: STUDENT_A,
  enrollmentId: ENROLL_A,
  questionId: QUESTION_ID,
  ...over
});
