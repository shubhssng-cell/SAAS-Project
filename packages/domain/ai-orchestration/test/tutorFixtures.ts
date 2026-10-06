import { percentagesConceptGraph } from "@ipmat/concept-graph";
import type { AiCompletion, AiProvider } from "@ipmat/ai";
import { createTutorService, type TutorAttemptRecord, type TutorQuestionRecord, type TutorServiceDeps } from "@ipmat/tutor";

/** LABELLED TEST FIXTURES: synthetic students and model outputs. No live model is ever called. */
export const STUDENT_A = "11111111-aaaa-4aaa-8aaa-111111111111";
export const STUDENT_B = "22222222-bbbb-4bbb-8bbb-222222222222";
export const ENROLL_A = "33333333-aaaa-4aaa-8aaa-333333333333";
export const ENROLL_B = "44444444-bbbb-4bbb-8bbb-444444444444";
export const ENROLL_A_OTHER = "55555555-aaaa-4aaa-8aaa-555555555555";
export const EXAM = "IPMAT_INDORE";
export const OTHER_EXAM = "OTHER_EXAM";
export const QUESTION_ID = "question-pct-1";
export const KEY = "₹500";
export const STEP_1 = "Compute the discounted price as 80 percent of the marked price of 625 rupees.";

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

export function tutorPorts(attempts: TutorAttemptRecord[] = [attempt()]) {
  const enrollments = [
    { studentId: STUDENT_A, enrollmentId: ENROLL_A, examCode: EXAM },
    { studentId: STUDENT_B, enrollmentId: ENROLL_B, examCode: EXAM },
    { studentId: STUDENT_A, enrollmentId: ENROLL_A_OTHER, examCode: OTHER_EXAM }
  ];
  const questions = [question(), question({ questionId: "question-other-1", examCode: OTHER_EXAM })];
  return {
    ownership: { resolveEnrollment: async (studentId: string, enrollmentId: string) => enrollments.find((e) => e.studentId === studentId && e.enrollmentId === enrollmentId) ?? null },
    questions: { getQuestion: async (examCode: string, id: string) => questions.find((q) => q.questionId === id && q.examCode === examCode) ?? null },
    concepts: { getConceptGraph: async () => percentagesConceptGraph },
    attempts: { getLatestAttempt: async (studentId: string, questionId: string) => attempts.find((a) => a.studentId === studentId && a.questionId === questionId) ?? null }
  };
}

export type Behaviour = string | { throws: Error } | { hangMs: number };
export class Scripted implements AiProvider {
  readonly name = "scripted";
  readonly model = "fixture-deterministic-v1";
  readonly apiKey = "sk-LIVE-SECRET-DO-NOT-LEAK";
  readonly prompts: Array<{ systemPrompt: string; userPrompt: string }> = [];
  constructor(private readonly script: Behaviour[]) {}
  async complete(input: { systemPrompt: string; userPrompt: string }): Promise<AiCompletion> {
    this.prompts.push({ systemPrompt: input.systemPrompt, userPrompt: input.userPrompt });
    const next = this.script.shift();
    if (next === undefined) throw new Error("no behaviour left");
    if (typeof next === "string") return { rawText: next, usage: { inputTokens: 0, outputTokens: 0 }, latencyMs: 1 };
    if ("throws" in next) throw next.throws;
    await new Promise((r) => setTimeout(r, next.hangMs));
    return { rawText: "{}", usage: null, latencyMs: next.hangMs };
  }
}

export const tutor = (script: Behaviour[], over: Partial<TutorServiceDeps> = {}) => {
  const provider = new Scripted(script);
  const service = createTutorService({ ...tutorPorts(), provider, now: () => new Date("2026-10-06T10:00:00.000Z"), newRequestId: () => "req-1", aiOptions: { maxRetries: 0, timeoutMs: 200 }, ...over });
  return { service, provider };
};

export const hintJson = (over: Record<string, unknown> = {}): string =>
  JSON.stringify({ responseType: "hint", text: "Think about what multiplier a 20 percent decrease gives.", citations: ["question"], hypotheses: [], relationClaims: [], questionQuotes: [], missingContext: [], ...over });
