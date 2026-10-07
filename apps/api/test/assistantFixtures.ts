import { createHash } from "node:crypto";
import type { AiCompletion, AiProvider } from "@ipmat/ai";
import { percentagesConceptGraph } from "@ipmat/concept-graph";
import type {
  AnswerKey,
  PaperCandidate,
  SimulationDefinition,
  SimulationQuestionContent,
  SimulationQuestionSource
} from "@ipmat/exam-simulation";
import type { TutorAttemptPort, TutorOwnershipPort, TutorQuestionPort, TutorQuestionRecord } from "@ipmat/tutor";
import type { AttemptHistoryReader } from "@ipmat/db";

/**
 * LABELLED TEST FIXTURES for the Phase 9 Unit 2 HTTP tests. The "model" is a deterministic double that behaves like a compliant
 * tutor (or, in the tests that need it, a hostile or failing one); no live model, key or network is involved anywhere.
 */
export const EXAM = "IPMAT_INDORE";
/** Sentinels: must never appear in a response unless a policy says the student may see them. */
export const KEY = "ANSWER-KEY-7731";
export const SOLUTION_STEP = "SOLUTION-STEP-SENTINEL-4419";
export const TRAP_CODE = "internal_trap_code_xyz";
export const CELL_ID = "cell-id-9f8e7d6c5b4a";
export const PROVIDER_SECRET = "sk-test-SECRET-PROVIDER-MESSAGE-0001";

export const tutorQuestion = (questionId: string, over: Partial<TutorQuestionRecord> = {}): TutorQuestionRecord => ({
  questionId,
  examCode: EXAM,
  validationState: "published",
  conceptName: "Percentages",
  stem: `Prompt for ${questionId}`,
  options: null,
  correctAnswer: KEY,
  solutionSteps: [SOLUTION_STEP],
  patternFamilyName: "Reverse Percentage",
  skill: "Apply a percentage change",
  difficultyTier: "standard",
  noveltyLevel: "standard",
  expectedTimeSeconds: 90,
  testingModes: ["direct"],
  trapLabel: null,
  internalTokens: [TRAP_CODE, CELL_ID],
  ...over
});

export function questionPort(ids: readonly string[], extra: TutorQuestionRecord[] = []): TutorQuestionPort {
  const all = [...ids.map((id) => tutorQuestion(id)), ...extra];
  return { getQuestion: async (examCode, id) => all.find((q) => q.questionId === id && q.examCode === examCode) ?? null };
}

/** Reads the student's OWN finalized attempts from the real in-memory attempt store (so the tutor sees what the practice routes recorded). */
export function attemptPort(history: AttemptHistoryReader): TutorAttemptPort {
  return {
    getLatestAttempt: async (studentId, questionId) => {
      const mine = (await history.findFinalizedByStudentId(studentId)).filter((a) => a.studentId === studentId && a.questionId === questionId);
      const a = mine[mine.length - 1];
      if (!a) return null;
      return {
        attemptId: a.id,
        studentId: a.studentId,
        questionId: a.questionId,
        status: a.status,
        finalAnswer: a.chosenAnswer,
        isCorrect: a.isCorrect,
        hintsUsed: a.hintsUsed,
        answerChanges: a.events.filter((e) => e.type === "answer_changed").length,
        timeTakenSeconds: a.timeSpentSeconds,
        workingSteps: null,
        reasoningText: null
      };
    }
  };
}

export function ownershipPort(find: (enrollmentId: string) => Promise<{ studentId: string } | null>): TutorOwnershipPort {
  return { resolveEnrollment: async (studentId, enrollmentId) => ((await find(enrollmentId))?.studentId === studentId ? { studentId, enrollmentId, examCode: EXAM } : null) };
}

export const conceptsPort = { getConceptGraph: async () => percentagesConceptGraph };

const RESPONSE_TYPE: Record<string, string> = {
  explain_question: "explanation",
  explain_concept: "concept_explanation",
  give_hint: "hint",
  guide_with_question: "guided_question",
  explain_mistake: "mistake_explanation",
  clarify_solution: "solution_clarification"
};

const asked = "It asks for a value after a percentage change.";
const concept = "A percentage change multiplies by the remaining or added fraction.";
const takeaway = "Convert the percentage into a multiplier first.";
const steps = ["Find the multiplier.", "Apply it to the starting value."];
const whyCorrect = "Multiplying by the multiplier applies the whole change once.";
const whyIncorrectPathFails = "Treating the percentage as a flat amount ignores that it applies to the value.";

function partsFor(intent: string, keyAuthorized: boolean): Record<string, unknown> | undefined {
  switch (intent) {
    case "explain_question":
      return keyAuthorized ? { asked, concept, takeaway, steps, whyCorrect } : { asked, concept, takeaway };
    case "explain_concept":
      return { concept, takeaway };
    case "explain_mistake":
      return { whyIncorrectPathFails, whyCorrect, takeaway };
    case "clarify_solution":
      return { asked, concept, steps, whyCorrect, takeaway };
    default:
      return undefined;
  }
}

/** A contract-complete model output for an intent (the same shape the tutor package's own fixtures use). */
export function modelOutput(intent: string, keyAuthorized: boolean, over: Record<string, unknown> = {}): string {
  const guided = intent === "guide_with_question";
  const parts = partsFor(intent, keyAuthorized);
  return JSON.stringify({
    responseType: RESPONSE_TYPE[intent],
    text: guided ? "What multiplier does a 20 percent decrease correspond to?" : "A short, neutral teaching response.",
    citations: guided ? ["concept:Percentages", "question"] : intent === "explain_concept" ? ["concept:Percentages"] : intent === "explain_mistake" ? ["attempt", "answer_key"] : intent === "clarify_solution" ? ["answer_key"] : ["question"],
    hypotheses: [],
    relationClaims: [],
    questionQuotes: [],
    missingContext: [],
    ...(parts ? { parts } : {}),
    ...(guided ? { socraticStep: { checks: "whether the student can name the multiplier", question: "What multiplier does a 20 percent decrease correspond to?", conceptRef: "concept:Percentages", evidenceRefs: ["question"], learnsFromReply: "whether the student treats the percentage as a multiplier or as a flat amount" } } : {}),
    ...over
  });
}

export type Mode = "compliant" | "leak_key" | "throw" | "malformed";

/**
 * A scripted provider that records every prompt. `compliant` answers with a valid output for the intent it can read from the
 * prompt and uses the key-bearing contract only when the key actually appears in the prompt it received (so it reacts to the
 * policy exactly as a well-behaved model would). Other modes are the failure/hostile cases.
 */
export class ScriptedProvider implements AiProvider {
  readonly name = "scripted";
  readonly model = "scripted-v1";
  readonly prompts: Array<{ systemPrompt: string; userPrompt: string }> = [];
  mode: Mode = "compliant";
  /** The text whose presence in the prompt means "the key was authorized" (the double reacts to policy like a compliant model). */
  keyMarker = KEY;
  /** What a hostile model puts in its answer in `leak_key` mode (default: the key marker). */
  leakText: string | null = null;

  async complete(input: { systemPrompt: string; userPrompt: string }): Promise<AiCompletion> {
    this.prompts.push({ systemPrompt: input.systemPrompt, userPrompt: input.userPrompt });
    if (this.mode === "throw") throw new Error(`upstream said: ${PROVIDER_SECRET}`);
    if (this.mode === "malformed") return { rawText: "this is not json", usage: { inputTokens: 1, outputTokens: 1 }, latencyMs: 1 };
    const intent = this.intent;
    const keyAuthorized = input.userPrompt.includes(this.keyMarker);
    const out = modelOutput(intent, keyAuthorized, this.mode === "leak_key" ? { text: `The answer is ${this.leakText ?? this.keyMarker}.` } : {});
    return { rawText: out, usage: { inputTokens: 10, outputTokens: 5 }, latencyMs: 1 };
  }

  /** The tests set this before each call (the prompt text format is the tutor package's business, not this double's). */
  intent = "explain_question";
}

// ---- simulation fixtures (an in-memory source; the CONFIG is a labelled test fixture, not an exam rule) ----
const fp = (body: string): string => createHash("sha256").update(body).digest("hex");
export const SIM_IDS = ["sim-q-1", "sim-q-2", "sim-q-3"];
export const SIM_DURATION = 600;

export function simulationSource(): SimulationQuestionSource {
  const body = (id: string): string => `Simulation prompt ${id}`;
  return {
    findPaperCandidates: async (examCode, ids): Promise<PaperCandidate[]> => ids.filter((id) => SIM_IDS.includes(id)).map((id) => ({ questionId: id, examCode, sectionName: "Section A", validationState: "published", sourceType: "original", contentFingerprint: fp(body(id)) })),
    findPublishedContent: async (_exam, ids): Promise<SimulationQuestionContent[]> => ids.filter((id) => SIM_IDS.includes(id)).map((id) => ({ questionId: id, prompt: body(id), answerFormat: "numeric_entry", options: null, contentFingerprint: fp(body(id)) })),
    findAnswerKeys: async (ids): Promise<AnswerKey> => Object.fromEntries(ids.map((id) => [id, { correctAnswer: KEY, contentFingerprint: fp(body(id)) }]))
  };
}

export const simulationDefinition: SimulationDefinition = {
  config: {
    examCode: EXAM,
    configVersion: "p9u2-fixture",
    overallDurationSeconds: SIM_DURATION,
    sections: [{ sectionName: "Section A", order: 1, questionCount: 3 }],
    provenance: { kind: "authored", sourceRef: "fixture:p9u2-test-configuration (not an exam rule)", reviewState: "unvalidated", reviewedBy: null, note: "TEST DATA" }
  },
  selection: { origin: "assembled", sourceRef: "fixture:p9u2-test-paper", sections: { "Section A": SIM_IDS } }
};
