import { ExamPackInvalidError, ExamPackNotFoundError, validateExamPack, type ExamPack, type ExamPackRepository } from "@ipmat/exam-pack";
import type { QuestionPatternFamilyData } from "@ipmat/question-engine";
import { evaluateGates } from "./gates.js";
import {
  AuthoringError,
  createDraft,
  editQuestion,
  publishQuestion,
  recordHumanReview,
  rejectQuestion,
  runAutomatedValidation,
  type NewQuestionInput,
  type QuestionEdit,
  type ValidationOutcome
} from "./lifecycle.js";
import type { QuestionAuthoringRepository } from "./repository.js";
import { buildConceptUniverse, buildExamQuestionUniverse, type ConceptUniverse } from "./universe.js";
import type { AuthoredQuestion, GateContext, GateReport, QuestionReview } from "./types.js";

export interface ContentAuthoringDeps {
  questions: QuestionAuthoringRepository;
  packs: ExamPackRepository;
  patternFamiliesFor: (examCode: string) => readonly QuestionPatternFamilyData[];
  errorTaxonomyCodes: readonly string[];
}

/**
 * Application layer: loads the question's OWN exam's pack (fail-closed on an
 * invalid pack), builds the gate context, applies the pure lifecycle
 * functions and persists the result. All content rules live in the domain
 * functions; this class only orchestrates. It never calls an AI model - an
 * AI-proposed question arrives as input, so any provider can produce it.
 */
export class ContentAuthoringService {
  constructor(private readonly deps: ContentAuthoringDeps) {}

  private async pack(examCode: string): Promise<ExamPack> {
    const pack = await this.deps.packs.findByExamCode(examCode);
    if (!pack) throw new ExamPackNotFoundError(examCode);
    const result = validateExamPack(pack);
    if (!result.valid) throw new ExamPackInvalidError(examCode, result.issues.filter((i) => i.severity === "error"));
    return pack;
  }

  private async context(examCode: string): Promise<GateContext> {
    return {
      pack: await this.pack(examCode),
      patternFamilies: this.deps.patternFamiliesFor(examCode),
      errorTaxonomyCodes: this.deps.errorTaxonomyCodes,
      existing: await this.deps.questions.listIdentityRefs(examCode)
    };
  }

  private async load(id: string): Promise<AuthoredQuestion> {
    const q = await this.deps.questions.findById(id);
    if (!q) throw new AuthoringError("invalid_transition", `no question "${id}"`);
    return q;
  }

  /** Stores a draft. Nothing is validated or claimed; an exact logical duplicate returns the existing identity. */
  async createDraft(input: NewQuestionInput): Promise<{ id: string; alreadyExisted: boolean }> {
    return this.deps.questions.createDraft(createDraft(input));
  }

  async edit(id: string, edit: QuestionEdit): Promise<AuthoredQuestion> {
    return this.deps.questions.mutate(id, (q) => editQuestion(q, edit));
  }

  async gateReport(id: string): Promise<GateReport> {
    const q = await this.load(id);
    return evaluateGates(q, await this.context(q.dna.examCode));
  }

  async validate(id: string): Promise<ValidationOutcome> {
    const q = await this.load(id);
    const ctx = await this.context(q.dna.examCode);
    let outcome: ValidationOutcome | null = null;
    await this.deps.questions.mutate(id, (current) => {
      outcome = runAutomatedValidation(current, ctx);
      return outcome.question;
    });
    return outcome!;
  }

  async review(id: string, review: QuestionReview, decision: "approve" | "reject"): Promise<ValidationOutcome> {
    const q = await this.load(id);
    const ctx = await this.context(q.dna.examCode);
    let outcome: ValidationOutcome | null = null;
    await this.deps.questions.mutate(id, (current) => {
      outcome = recordHumanReview(current, review, decision, ctx);
      return outcome.question;
    });
    return outcome!;
  }

  async reject(id: string): Promise<AuthoredQuestion> {
    return this.deps.questions.mutate(id, rejectQuestion);
  }

  async publish(id: string): Promise<AuthoredQuestion> {
    const q = await this.load(id);
    const ctx = await this.context(q.dna.examCode);
    return this.deps.questions.mutate(id, (current) => publishQuestion(current, ctx));
  }

  async conceptUniverse(examCode: string, conceptName: string): Promise<ConceptUniverse> {
    return buildConceptUniverse({
      pack: await this.pack(examCode),
      patternFamilies: this.deps.patternFamiliesFor(examCode),
      questions: await this.deps.questions.listUniverseRefs(examCode),
      conceptName
    });
  }

  async examUniverse(examCode: string): Promise<ConceptUniverse[]> {
    return buildExamQuestionUniverse(await this.pack(examCode), this.deps.patternFamiliesFor(examCode), await this.deps.questions.listUniverseRefs(examCode));
  }
}
