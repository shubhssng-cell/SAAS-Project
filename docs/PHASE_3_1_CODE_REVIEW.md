# Phase 3.1 Code Review — Implementation-Level

**Scope:** only the changes that materially affect correctness, trust boundaries, validation, and generation safety. This is not a summary — it quotes the actual current source, the actual diff against Phase 3, and the actual tests, then asks the adversarial question for each: *what could still get past this?* Several findings below are genuine gaps discovered while writing this review, not previously documented in [PHASE_3_1_REVIEW.md](PHASE_3_1_REVIEW.md) — they are called out explicitly in §10.

No implementation was modified to produce this document.

---

## 1. `verifierView.ts` — the leakage boundary

**Current code** (`packages/domain/question-engine/src/verifierView.ts`, unchanged since last read):

```ts
import type { DifficultyTier } from "./types.js";
import type { QuestionCandidateAiOutput } from "@ipmat/ai";

export interface PresentedQuestionView {
  stem: string;
  options: string[] | null;
  answerFormat: "multiple_choice" | "numeric_entry";
}

export function toPresentedQuestionView(candidate: QuestionCandidateAiOutput): PresentedQuestionView {
  return {
    stem: candidate.stem,
    options: candidate.options,
    answerFormat: candidate.answerFormat
  };
}

export interface JudgeView extends PresentedQuestionView {
  claimedDifficultyTier: DifficultyTier;
}

export function toJudgeView(candidate: QuestionCandidateAiOutput): JudgeView {
  return {
    ...toPresentedQuestionView(candidate),
    claimedDifficultyTier: candidate.questionDna.difficultyTier
  };
}
```

**Diff:** entirely new file (44 lines added, none removed).

**Invariant it's supposed to enforce:** the reverification and judge AI calls can never receive `correctAnswer`, `expectedAnswer`, `groundTruthDerivation`, `explanation`, `solutionSteps`, or `reasoning` — they must be structurally blind to the first call's claims.

**What could still bypass it:**

1. **The stem itself is untrusted, AI-generated text, and it IS forwarded in full.** Nothing here — or anywhere in the pipeline — screens `candidate.stem` for answer-shaped content before it's shown to the verifiers. A malformed or adversarial generation call could produce a stem like *"A price increased by 20% to 480. What was the original price?"* — the answer is embedded in the wording, not in a separate field this code excludes. This is the single most realistic bypass of the leakage boundary, and it is not addressed by this file or anywhere else in Phase 3.1. It's arguably not fully fixable by input-filtering (a well-posed question legitimately states all its given quantities), but a stem that also states the *derived* quantity as if given is a real failure mode this boundary does not detect.
2. **The type system doesn't enforce anything at runtime.** `PresentedQuestionView`/`JudgeView` are erased at compile time. Nothing stops a future call site from doing `buildReverificationUserPrompt({ stem, options, answerFormat, ...candidate } as any)` — TypeScript's excess-property check only fires on object *literals* assigned directly to a typed variable/parameter, not on a value that's been through an `as` assertion or built dynamically. The actual safety today comes from two things working together: (a) `toPresentedQuestionView`/`toJudgeView` are the only functions that construct these objects in the codebase, and they use explicit field-by-field construction, never a spread of the candidate; (b) `buildReverificationUserPrompt`/`buildJudgeUserPrompt` (§8) only *read* the specific fields they reference, so even an object with extra properties smuggled onto it wouldn't have those properties end up in the rendered prompt text. Belt and suspenders — but the "belt" (the type) is advisory, not enforced; the "suspenders" (narrow field access in the prompt builders) is what actually holds.

**Does the test prove the invariant?** `packages/domain/question-engine/test/verifierView.test.ts` (§9 below) proves two real things: the constructed view objects have exactly the allowed keys (by `Set` equality), and prompts built from a candidate with marker strings planted in every excluded field never contain those markers. This is a genuine, non-trivial test — it doesn't just check the type, it exercises the real functions end-to-end and asserts on the actual string sent. It proves the invariant **for the code path that exists today** (`toXView()` → `buildXPrompt()`). It does not and cannot prove that a future call site bypassing these functions would be caught — there's no lint rule or runtime guard forcing every reverification/judge prompt through this module.

---

## 2. `verifyComputation.ts` — independent arithmetic verification

**Current code** (`packages/domain/validation/src/verifyComputation.ts`):

```ts
import { evaluate } from "mathjs";
import { fail, ok, type ValidationResult } from "./types.js";

const EPSILON = 1e-6;

const SAFE_ARITHMETIC_PATTERN = /^[\d\s+\-*/^().,]+$/;

export function verifyComputation(input: {
  computation: string;
  expectedAnswer: number;
  correctAnswer: string;
}): ValidationResult {
  if (!SAFE_ARITHMETIC_PATTERN.test(input.computation)) {
    return fail(
      "impossible_computation",
      "groundTruthDerivation.computation",
      "Computation contains characters outside plain arithmetic (digits, + - * / ^ ( ) . ,) and was rejected without evaluation"
    );
  }

  let recomputed: unknown;
  try {
    recomputed = evaluate(input.computation);
  } catch (error) {
    return fail(
      "impossible_computation",
      "groundTruthDerivation.computation",
      `Computation could not be evaluated: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  if (typeof recomputed !== "number" || !Number.isFinite(recomputed)) {
    return fail(
      "impossible_computation",
      "groundTruthDerivation.computation",
      `Computation did not evaluate to a finite number (got ${JSON.stringify(recomputed)})`
    );
  }

  if (Math.abs(recomputed - input.expectedAnswer) > EPSILON) {
    return fail(
      "answer_mismatch",
      "groundTruthDerivation.expectedAnswer",
      `Independently recomputed value (${recomputed}) does not match the candidate's stated expectedAnswer (${input.expectedAnswer})`
    );
  }

  const correctAnswerNumeric = parseNumeric(input.correctAnswer);
  if (correctAnswerNumeric === null) {
    return fail(
      "unverifiable_answer",
      "correctAnswer",
      `correctAnswer "${input.correctAnswer}" could not be parsed as a plain number and cannot be independently verified`
    );
  }
  if (Math.abs(recomputed - correctAnswerNumeric) > EPSILON) {
    return fail(
      "answer_mismatch",
      "correctAnswer",
      `Independently recomputed value (${recomputed}) does not match the stated correctAnswer ("${input.correctAnswer}")`
    );
  }

  return ok();
}

function parseNumeric(value: string): number | null {
  const cleaned = value
    .trim()
    .replace(/^(₹|\$|Rs\.?)\s*/i, "")
    .replace(/%$/, "")
    .replace(/,/g, "")
    .trim();
  if (cleaned.length === 0 || !/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}
```

**Exact independent-verification input:** `{ computation: string, expectedAnswer: number, correctAnswer: string }` — all three come from the candidate's own `groundTruthDerivation`/`correctAnswer` fields; there is no separate "ground truth" source. The independence comes entirely from `computation` being *evaluated by mathjs*, not read as a claim.

**Exact fail-closed behavior:** an unparseable `correctAnswer` → `unverifiable_answer`, hard rejection (was: silently skipped, and `Number("")` coercing to `0` could make an empty answer falsely "match"). A `computation` string containing anything outside `[\d\s+\-*/^().,]` → `impossible_computation`, rejected *without calling `evaluate()`*.

**What could still bypass it:**

1. **The `,` in `SAFE_ARITHMETIC_PATTERN` doesn't do what it looks like it's for, and may not be safe the way it's assumed to be.** The comment says the allowlist exists so "a computation that needs more than digits and `+ - * / ^ ( ) . ,` is rejected." But mathjs's `evaluate()` treats a top-level comma as a **statement separator**, not a thousands-grouping character — `evaluate("1,000")` does not parse as the number 1000; comma-separated expressions in mathjs evaluate as a sequence and (depending on version/grammar) can return an array or the last statement's value. If a generated `computation` string ever legitimately contained a comma (e.g. a model copying "1,000" formatting into the expression by habit), the result could silently become a non-number — which IS caught by the `typeof recomputed !== "number"` check three lines later, so this doesn't currently create a false pass. But it means the `,` character in the allowlist is not doing useful work for its apparent purpose, and its interaction with mathjs's actual grammar was not verified against mathjs's real parsing behavior for multi-statement input — only against the single deliberately-malicious test case (§9). This is worth a human's attention: either confirm mathjs's comma-as-separator behavior is fully benign in all cases, or drop `,` from the computation allowlist entirely and require callers to strip formatting before this field is populated (the `parseNumeric` helper already does exactly that for `correctAnswer` — `computation` has no equivalent pre-cleaning step).
2. **No bound on computational cost or numeric magnitude.** The allowlist blocks *code injection* but not *resource exhaustion*: a string like `"9999999999999999999999^9999999999999999999999"` passes the regex (only digits and `^`) and would be handed to `mathjs.evaluate()` uncapped — extremely large exponentiation can be slow or memory-heavy. There is no length cap on `computation`, no timeout around the `evaluate()` call, and no magnitude check on the result before the equality comparisons. This is a plausible availability concern for a function whose whole point is processing untrusted AI output.
3. **Absolute epsilon (`1e-6`), not relative.** For an expected answer in the millions (plausible for some quant word problems), floating-point representation error alone can exceed `1e-6` in absolute terms, which would cause a **false rejection** of a genuinely correct answer. This fails safe (rejects rather than wrongly accepts), but it's a correctness bug in the making for larger-magnitude questions, not just a theoretical one.
4. **No knowledge of `answerFormat`.** This function has no idea whether the candidate is `multiple_choice` or `numeric_entry`; it always requires `correctAnswer` to parse as a plain number. A legitimately non-numeric but verifiable answer type — a ratio ("3:4"), an interval, or "cannot be determined" *when that genuinely is the correct choice for the question design* — is unconditionally rejected as `unverifiable_answer`. This may be an acceptable, deliberate scope limit (Phase 3.1 §3 explicitly said not to over-engineer format support) but it is a real constraint on what pattern families this pipeline can ever validate, worth being explicit about rather than discovering later.

**Does the test prove the invariant?** `packages/domain/validation/test/validateCandidate.test.ts` proves: fail-closed on unparseable text (`"cannot be determined from the given information"` → `unverifiable_answer`), fail-closed on empty string (proving the `Number("")===0` bug specifically is fixed), the three supported formats (₹ prefix, comma thousands, `%` suffix) all still pass, an uncomputable expression (`"1 / 0 * undefined_symbol("`) is rejected, and a prototype-pollution-style payload (`"constructor.constructor('return process')()"`) is rejected **without evaluation** (checked via the specific error message, not just a rejection). This is solid, targeted coverage of the fail-closed behavior and the one injection pattern tested. **It does not** test the DoS/magnitude concern, the large-number epsilon precision concern, or the comma-as-statement-separator ambiguity — none of those have a fixture or assertion anywhere in the suite.

---

## 3. `qualityValidators.ts` — an important scope correction first

**The requested framing ("answer validation, ambiguity / contradiction / multiple-answer checks") does not match where this logic actually lives, and that distinction matters.** `qualityValidators.ts` contains exactly one answer-shaped check — `validateSingleCorrectAnswer`, which is a **deterministic, format-level** check: does the candidate's own claimed `correctAnswer` appear exactly once among its own `options`. **Ambiguity and contradictory-conditions detection are not in this file at all** — they live in `packages/domain/validation/src/judgeInterpretation.ts`, and depend entirely on the AI-judge call's own output; there is no deterministic fallback for either. This file cannot detect "could a student reasonably defend two different options as correct" — it can only detect "does the model's own stated answer show up exactly once in its own options list." Presenting this as one unified "answer validation" capability would overstate what's deterministically checked.

**Current code** (`packages/domain/validation/src/qualityValidators.ts`, full file):

```ts
import { findCompletenessClaims } from "@ipmat/examiner-lens";
import { hasConcept, type ConceptGraph } from "@ipmat/concept-graph";
import type { QuestionCandidateAiOutput } from "@ipmat/ai";
import { fail, mergeResults, ok, type ValidationResult } from "./types.js";

export interface BlueprintExpectation {
  id: string;
  conceptName: string;
  patternFamilyName: string;
  difficultyTier: string;
  requiredTestingModes: string[];
  trapErrorTaxonomyCode: string | null;
  combinationConcepts: string[];
}

function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const setB = new Set(b);
  return a.every((item) => setB.has(item));
}

export function validateBlueprintCompliance(
  candidate: QuestionCandidateAiOutput,
  blueprint: BlueprintExpectation
): ValidationResult {
  const issues: ValidationResult[] = [];
  if (candidate.blueprintId !== blueprint.id) {
    issues.push(fail("blueprint_violation", "blueprintId",
      `Candidate echoed blueprintId "${candidate.blueprintId}", expected "${blueprint.id}"`));
  }
  if (candidate.questionDna.conceptName !== blueprint.conceptName) {
    issues.push(fail("blueprint_violation", "questionDna.conceptName",
      `Candidate targets concept "${candidate.questionDna.conceptName}", blueprint specified "${blueprint.conceptName}"`));
  }
  if (candidate.questionDna.patternFamilyName !== blueprint.patternFamilyName) {
    issues.push(fail("blueprint_violation", "questionDna.patternFamilyName",
      `Candidate targets pattern family "${candidate.questionDna.patternFamilyName}", blueprint specified "${blueprint.patternFamilyName}"`));
  }
  if (candidate.questionDna.difficultyTier !== blueprint.difficultyTier) {
    issues.push(fail("blueprint_violation", "questionDna.difficultyTier",
      `Candidate claims difficulty tier "${candidate.questionDna.difficultyTier}", blueprint specified "${blueprint.difficultyTier}"`));
  }
  const candidateTestingModes: string[] = candidate.questionDna.testingModes;
  const missingModes = blueprint.requiredTestingModes.filter((mode) => !candidateTestingModes.includes(mode));
  if (missingModes.length > 0) {
    issues.push(fail("blueprint_violation", "questionDna.testingModes",
      `Candidate is missing required testing mode(s) from the blueprint: ${missingModes.join(", ")}`));
  }
  if (blueprint.trapErrorTaxonomyCode !== null && candidate.questionDna.trapErrorTaxonomyCode !== blueprint.trapErrorTaxonomyCode) {
    issues.push(fail("blueprint_violation", "questionDna.trapErrorTaxonomyCode",
      `Candidate built in trap "${candidate.questionDna.trapErrorTaxonomyCode}", blueprint required "${blueprint.trapErrorTaxonomyCode}"`));
  }
  if (!sameSet(candidate.questionDna.combinesWithConcepts, blueprint.combinationConcepts)) {
    issues.push(fail("blueprint_violation", "questionDna.combinesWithConcepts",
      `Candidate combines with [${candidate.questionDna.combinesWithConcepts.join(", ")}], blueprint required exactly [${blueprint.combinationConcepts.join(", ")}]`));
  }
  return mergeResults(...issues);
}

export function validateSyllabusCompatibility(candidate: QuestionCandidateAiOutput, graph: ConceptGraph): ValidationResult {
  const names = [
    candidate.questionDna.conceptName,
    ...candidate.questionDna.subconcepts,
    ...candidate.questionDna.prerequisites,
    ...candidate.questionDna.combinesWithConcepts
  ];
  const issues = names
    .filter((name) => !hasConcept(graph, name))
    .map((name) => fail("out_of_syllabus", "questionDna", `"${name}" is not a concept in the seeded graph`));
  return mergeResults(...issues, ok());
}

export function validateSingleCorrectAnswer(candidate: QuestionCandidateAiOutput): ValidationResult {
  if (candidate.answerFormat !== "multiple_choice") return ok();
  const options = candidate.options ?? [];
  if (options.length === 0) {
    return fail("multiple_or_no_correct_answer", "options", "multiple_choice format requires a non-empty options array");
  }
  const matches = options.filter((option) => option.trim() === candidate.correctAnswer.trim());
  if (matches.length !== 1) {
    return fail("multiple_or_no_correct_answer", "options",
      `correctAnswer must appear exactly once among options (found ${matches.length} match(es))`);
  }
  const uniqueOptions = new Set(options.map((option) => option.trim()));
  if (uniqueOptions.size !== options.length) {
    return fail("distractor_quality", "options", "options array contains duplicate values");
  }
  return ok();
}
```
(`validateNoCompletenessClaims`, `validateProvenancePresent` omitted — unchanged by Phase 3.1.)

**Invariant it's supposed to enforce:** (a) a candidate cannot silently diverge from its blueprint on any of 7 checked fields; (b) for MCQ candidates, the claimed answer appears exactly once in the options and options aren't duplicated.

**What could still bypass it:**

1. **`validateSingleCorrectAnswer`'s match check is case-sensitive and exact-string after only `.trim()`.** `"Rupees 480"` vs `"rupees 480"`, or `"480"` vs `"480.0"`, would not match. This fails *safe* (0 matches → rejected as `multiple_or_no_correct_answer`), but it means a genuinely well-formed question could be wrongly rejected purely on formatting inconsistency between the model's own `correctAnswer` and `options` fields — a false negative on question quality, not a safety hole, but worth knowing before treating rejection rate as a pure quality signal.
2. **`distractor_quality` (the duplicate-options branch) is unreachable by every existing test.** The one fixture that could exercise it (`multipleCorrectAnswerCandidate`) has duplicate options that ALSO happen to duplicate the *correct* answer, so the function returns early on `multiple_or_no_correct_answer` before ever reaching the `uniqueOptions.size !== options.length` check. There is no fixture with unique-correct-answer-but-duplicate-wrong-options. This is dead-in-tests code — it may well work, but nothing currently proves it does.
3. **`validateSyllabusCompatibility` checks concept *names* for existence, not that the relationships they imply are real.** A candidate can freely combine any two concepts that both individually exist in the graph, in `combinesWithConcepts`, and this function will pass it — the actual "is this a sanctioned combination" check lives in `validateBlueprintCompliance`'s `sameSet` comparison against the blueprint, a separate function. As long as the blueprint's `combinationConcepts` set is respected, this is fine; it's just worth being clear that "syllabus compatibility" here means "these are real concepts," not "this combination makes pedagogical sense."

**Does the test prove the invariant?** `validateCandidate.test.ts` has five dedicated fixtures/tests for the five *new* blueprint-compliance checks (difficulty tier, testing modes, trap, combination concepts, plus the pre-existing pattern-family case), each asserting the specific `field` value on the resulting issue — genuinely strong, specific coverage of §7's requirement. `multiple_or_no_correct_answer` is tested for the exact-duplicate case. **`distractor_quality` has zero test coverage**, as noted above — this is a real gap, not an oversight in this review.

---

## 4. `generationPipeline.ts` — orchestration, gating, ordering

**Current code** (`packages/domain/question-engine/src/generationPipeline.ts`, full file — 203 lines, reproduced because ordering and gating are exactly what's under review):

```ts
import type { ConceptGraph } from "@ipmat/concept-graph";
import {
  answerReverificationAiSchema,
  generateStructured,
  questionCandidateAiSchema,
  validationJudgeAiSchema,
  AiGenerationError,
  type AiProvider,
  type AiResultMetadata,
  type QuestionCandidateAiOutput
} from "@ipmat/ai";
import {
  checkDuplicateRisk,
  compareReverification,
  fail,
  interpretJudgeVerdict,
  validateCandidateStructurally,
  verifyComputation,
  type ValidationIssue,
  type ValidationResult
} from "@ipmat/validation";
import type { QuestionBlueprint } from "./blueprint.js";
import { DEFAULT_SINGLE_RUN_LIMITS, validateGenerationLimits, type GenerationLimits } from "./generationLimits.js";
import { computeLifecycleStatus, type QuestionLifecycleStatus } from "./lifecycle.js";
import {
  buildGenerationSystemPrompt, buildGenerationUserPrompt,
  buildJudgeSystemPrompt, buildJudgeUserPrompt,
  buildReverificationSystemPrompt, buildReverificationUserPrompt
} from "./prompts.js";
import { toJudgeView, toPresentedQuestionView } from "./verifierView.js";

export interface GenerationPipelineInput {
  blueprint: QuestionBlueprint;
  aiProvider: AiProvider;
  graph: ConceptGraph;
  existingQuestionStems: string[];
  provenanceSourceType: string | null;
  limits?: GenerationLimits;
}

export async function runGenerationPipeline(input: GenerationPipelineInput): Promise<GenerationPipelineResult> {
  const limits = input.limits ?? DEFAULT_SINGLE_RUN_LIMITS;
  validateGenerationLimits(limits); // throws before any AI call if the limits themselves are unsafe

  let runningCostUsd = 0;
  const trackCost = (metadata: AiResultMetadata | null) => {
    if (metadata?.estimatedCostUsd) runningCostUsd += metadata.estimatedCostUsd;
  };
  const overBudget = () => runningCostUsd > limits.maxEstimatedBudgetUsd;

  const blueprintExpectation = {
    id: input.blueprint.id,
    conceptName: input.blueprint.conceptName,
    patternFamilyName: input.blueprint.patternFamilyName,
    difficultyTier: input.blueprint.difficultyTier,
    requiredTestingModes: input.blueprint.testingModes,
    trapErrorTaxonomyCode: input.blueprint.trapErrorTaxonomyCode,
    combinationConcepts: input.blueprint.combinationConcepts
  };

  let candidate: QuestionCandidateAiOutput;
  let generationMetadata: AiResultMetadata;
  try {
    const result = await generateStructured(input.aiProvider, {
      task: "question-generation", promptVersion: "question-generation-v1",
      systemPrompt: buildGenerationSystemPrompt(),
      userPrompt: buildGenerationUserPrompt(input.blueprint),
      schema: questionCandidateAiSchema,
      options: { maxRetries: limits.maxRetries, timeoutMs: 30_000 }
    });
    candidate = result.data;
    generationMetadata = result.metadata;
    trackCost(generationMetadata);
  } catch (error) {
    const aiError = error instanceof AiGenerationError ? error : null;
    const failure = fail("malformed_output", "generation", aiError?.message ?? "Generation call failed");
    return {
      blueprint: input.blueprint, candidate: null,
      metadata: { generation: aiError?.metadata ?? null, reverification: null, judge: null },
      checks: { structural: failure, computation: failure, reverification: failure, duplicateRisk: failure, judge: failure },
      status: "rejected", rejectionReasons: failure.issues
    };
  }

  const structural = validateCandidateStructurally(candidate, input.graph, blueprintExpectation, input.provenanceSourceType);

  const computation = verifyComputation({
    computation: candidate.groundTruthDerivation.computation,
    expectedAnswer: candidate.groundTruthDerivation.expectedAnswer,
    correctAnswer: candidate.correctAnswer
  });

  let reverification: ValidationResult;
  let reverificationMetadata: AiResultMetadata | null;
  if (overBudget()) {
    reverificationMetadata = null;
    reverification = fail("budget_exceeded", "reverification",
      `Skipped: running estimated cost ($${runningCostUsd.toFixed(4)}) already exceeds maxEstimatedBudgetUsd ($${limits.maxEstimatedBudgetUsd})`);
  } else {
    try {
      const result = await generateStructured(input.aiProvider, {
        task: "answer-reverification", promptVersion: "answer-reverification-v1",
        systemPrompt: buildReverificationSystemPrompt(),
        userPrompt: buildReverificationUserPrompt(toPresentedQuestionView(candidate)),
        schema: answerReverificationAiSchema,
        options: { maxRetries: limits.maxRetries, timeoutMs: 30_000 }
      });
      reverificationMetadata = result.metadata;
      trackCost(reverificationMetadata);
      reverification = compareReverification({ candidateAnswer: candidate.correctAnswer, reDerivedAnswer: result.data.derivedAnswer });
    } catch (error) {
      const aiError = error instanceof AiGenerationError ? error : null;
      reverificationMetadata = aiError?.metadata ?? null;
      trackCost(reverificationMetadata);
      reverification = fail("answer_mismatch", "reDerivedAnswer", `Independent re-derivation call failed: ${aiError?.message ?? "unknown error"}`);
    }
  }

  const duplicateRisk = checkDuplicateRisk(candidate.stem, input.existingQuestionStems);

  let judge: ValidationResult;
  let judgeMetadata: AiResultMetadata | null;
  if (overBudget()) {
    judgeMetadata = null;
    judge = fail("budget_exceeded", "judge",
      `Skipped: running estimated cost ($${runningCostUsd.toFixed(4)}) already exceeds maxEstimatedBudgetUsd ($${limits.maxEstimatedBudgetUsd})`);
  } else {
    try {
      const result = await generateStructured(input.aiProvider, {
        task: "validation-judge", promptVersion: "validation-judge-v1",
        systemPrompt: buildJudgeSystemPrompt(),
        userPrompt: buildJudgeUserPrompt(toJudgeView(candidate)),
        schema: validationJudgeAiSchema,
        options: { maxRetries: limits.maxRetries, timeoutMs: 30_000 }
      });
      judgeMetadata = result.metadata;
      trackCost(judgeMetadata);
      judge = interpretJudgeVerdict(result.data);
    } catch (error) {
      const aiError = error instanceof AiGenerationError ? error : null;
      judgeMetadata = aiError?.metadata ?? null;
      trackCost(judgeMetadata);
      judge = fail("judge_ambiguous", "judge", `Validation-judge call failed: ${aiError?.message ?? "unknown error"}`);
    }
  }

  const checks = { structural, computation, reverification, duplicateRisk, judge };
  const allChecksPassed = Object.values(checks).every((result) => result.valid);
  const status = computeLifecycleStatus({ allChecksPassed, difficultyTier: candidate.questionDna.difficultyTier });

  return {
    blueprint: input.blueprint, candidate,
    metadata: { generation: generationMetadata, reverification: reverificationMetadata, judge: judgeMetadata },
    checks, status,
    rejectionReasons: Object.values(checks).flatMap((result) => result.issues)
  };
}
```

**Blueprint compliance:** delegated entirely to `validateCandidateStructurally` → `validateBlueprintCompliance` (§3) via the `blueprintExpectation` object built at the top of the function from `input.blueprint`'s 7 relevant fields.

**Publish gating:** `computeLifecycleStatus()` (unchanged this phase, `packages/domain/question-engine/src/lifecycle.ts`) returns only `rejected | validated | review_required` — this function itself never produces `published`. **Important nuance:** `lifecycle.ts`'s own transition table *does* allow `validated → published` directly (matching the documented D-008 auto-publish policy for Standard/Advanced tiers) — so "never auto-publish" is true of everything this pipeline currently *does*, not a structural impossibility of the state machine. Nothing in this repository currently calls that transition (there's no persistence layer at all), but a future caller legally could, for Standard/Advanced-tier content, with zero additional human gate. That's the documented policy, not a bug — but it's worth being precise that the safety here is "no code exercises the risky transition yet," not "the risky transition doesn't exist."

**Validation ordering:** structural → computation → reverification (budget-gated) → duplicate risk → judge (budget-gated), confirmed by reading top to bottom: there is no early return between these five once the initial generation call succeeds. All five populate `checks` regardless of any individual failure. The one place *there is* short-circuiting is the initial generation call itself — if that fails, the function returns immediately with all five checks set to references to the *same* single `failure` object, and `rejectionReasons: failure.issues` (not `Object.values(checks).flatMap(...)`, which — since all five checks are the same object reference in this branch — would otherwise report the identical issue five times over). That's a correct, deliberate difference between the two return paths, not an inconsistency.

**Rejection behavior:** every rejection carries a `RejectionCode` + `field` + `message` (via `fail()`); a failed AI call is caught and converted to a `ValidationResult`, never left to propagate as an unhandled promise rejection (except when `validateGenerationLimits()` itself throws, which is intentional — invalid *configuration* is a programmer error, not a runtime rejection, and Phase 3.1 §9 explicitly wants that case to throw before any AI call is attempted).

**What could still bypass it / concerns:**

1. **`maxGenerationAttempts` is validated but never read inside this function.** `validateGenerationLimits()` checks it's internally consistent (§6), but `runGenerationPipeline` has no loop and makes exactly one generation attempt regardless of what `maxGenerationAttempts` says — the field currently bounds nothing at runtime because the loop it would bound doesn't exist yet. Not a bug given the phase's explicit scope, but a reader should not assume this field currently *prevents* anything beyond config nonsense.
2. **The budget circuit breaker is reactive, checked between calls, not during one.** Already flagged in [PHASE_3_1_REVIEW.md](PHASE_3_1_REVIEW.md) §11 — restated here because it's directly visible in this file: `overBudget()` is only consulted *before* the reverification and judge calls, never during the generation call itself. See §6 for why this is more (and less) concerning than it first appears once `AnthropicProvider`'s hardcoded `max_tokens` is factored in.
3. **Concurrency is safe by construction.** `runningCostUsd`, `trackCost`, `overBudget` are all local to one invocation (closures, not module state) — parallel calls to `runGenerationPipeline` would not share or corrupt each other's budget tracking. Worth stating as a positive finding relevant to any future batch orchestrator built on top of this function.

**Does the test prove the invariant?** `generationPipeline.test.ts` (§9) directly proves: no short-circuiting (the wrong-answer test shows computation AND reverification both fail while judge independently passes — three different outcomes in one run, which could only happen if all three ran); safe termination on generation failure; Hard-tier `review_required` gating; invalid-limits-throws-before-any-call; and the budget breaker skipping both remaining calls with `metadata: null`. This is strong, specific coverage of exactly the claims made above. It does **not** exercise the `validated → published` transition being externally reachable (nothing in the suite calls `isValidTransition` from outside `lifecycle.test.ts`), nor `maxGenerationAttempts`'s current inertness (there's no test asserting it does nothing — that's a documentation gap more than a test gap, since there's nothing to test yet).

---

## 5. `comparisonReport.ts` — four-category combination classification

**Current code** (relevant excerpt, `packages/domain/question-engine/src/comparisonReport.ts`):

```ts
const realCombinationConcepts = new Set(
  deriveCombinations(graph, human.concept).map((candidate) => candidate.concept)
);
const allRelatedConcepts = new Set(
  getAllRelationsFor(graph, human.concept).map((edge) => (edge.from === human.concept ? edge.to : edge.from))
);
const aiSuggestedConcepts = ai.suggestedCombinations.map((s) => s.concept);

const validGenerationCombination = aiSuggestedConcepts.filter((concept) => realCombinationConcepts.has(concept));
const relatedButNonCombinable = aiSuggestedConcepts.filter(
  (concept) => allRelatedConcepts.has(concept) && !realCombinationConcepts.has(concept)
);
const unsupportedByGraph = aiSuggestedConcepts.filter((concept) => !allRelatedConcepts.has(concept));
const missedByAi = [...realCombinationConcepts].filter((concept) => !aiSuggestedConcepts.includes(concept));
```

**Invariant:** every AI-suggested concept lands in exactly one of `validGenerationCombination` / `relatedButNonCombinable` / `unsupportedByGraph`; `missedByAi` is computed independently from the graph, not from what the AI said.

**What could still bypass it:**

1. **No name normalization — this is a real, previously-undocumented gap.** All three membership tests (`realCombinationConcepts.has(concept)`, `allRelatedConcepts.has(concept)`, and the implicit exact-string match) are case-sensitive, exact-string `Set` lookups against `ai.suggestedCombinations[].concept`. If a real model returns `"ratio"` instead of `"Ratio"`, or `"Profit & Loss"` instead of `"Profit and Loss"`, it will match **none** of the graph-derived sets and fall into `unsupportedByGraph` — reported as an *invented* relationship, when it's actually a real one the AI referred to with different formatting. Since the whole point of this report is "do not assume AI is correct," a false "AI invented this" finding caused by a formatting mismatch is a real risk to the report's own credibility, and nothing in the code or prompts (`buildLensRegenerationUserPrompt`, §8) constrains the model to echo concept names verbatim.
2. **Precedence between categories, when a concept has edges of multiple types, favors "valid."** If a concept pair has both a useful edge (e.g. `application`) and a non-useful edge (e.g. `related_but_distinct`) between them, `validGenerationCombination` wins (since `realCombinationConcepts` is checked first and independently) — `relatedButNonCombinable` never fires for that pair even though a "do not combine" edge also exists. This appears to be the *correct* choice (a real useful relationship existing is enough to justify combination, regardless of what else is also true about the pair), but it's an implicit design decision, not one stated anywhere in the code or docs, and worth a human confirming it's intended.
3. **No deduplication of `aiSuggestedConcepts`.** If the AI proposes the same concept twice (with two different rationales), it appears twice in whichever category array — inflating counts in any downstream reporting that sums array lengths, though it doesn't affect the boolean categorization logic itself.

**Does the test prove the invariant?** `comparisonReport.test.ts` has one dedicated test per category plus an explicit mutual-exclusivity test iterating every `aiSuggested` concept and asserting membership in exactly one of the three AI-facing sets. This is genuinely thorough for the categorization logic *as exercised by the fixture*. **It does not** test the case-sensitivity/name-mismatch scenario at all — the fixture's AI-proposed names all happen to exactly match the graph's canonical casing, so this gap was invisible to the existing suite and only surfaced by deliberately asking "what could bypass this."

---

## 6. `generationLimits.ts` — budget, retries, circuit breaker

**Current code** (full file, `packages/domain/question-engine/src/generationLimits.ts`):

```ts
export interface GenerationLimits {
  maxBlueprints: number;
  maxCandidatesPerBlueprint: number;
  maxRetries: number;
  maxGenerationAttempts: number;
  maxEstimatedBudgetUsd: number;
}

export const DEFAULT_SINGLE_RUN_LIMITS: GenerationLimits = {
  maxBlueprints: 1,
  maxCandidatesPerBlueprint: 1,
  maxRetries: 2,
  maxGenerationAttempts: 1,
  maxEstimatedBudgetUsd: 1.0
};

export function validateGenerationLimits(limits: GenerationLimits): void {
  const checks: Array<[boolean, string]> = [
    [Number.isInteger(limits.maxBlueprints) && limits.maxBlueprints > 0, "maxBlueprints must be a positive integer"],
    [Number.isInteger(limits.maxCandidatesPerBlueprint) && limits.maxCandidatesPerBlueprint > 0, "maxCandidatesPerBlueprint must be a positive integer"],
    [Number.isInteger(limits.maxRetries) && limits.maxRetries >= 0, "maxRetries must be a non-negative integer"],
    [Number.isInteger(limits.maxGenerationAttempts) && limits.maxGenerationAttempts > 0, "maxGenerationAttempts must be a positive integer"],
    [limits.maxGenerationAttempts >= limits.maxBlueprints * limits.maxCandidatesPerBlueprint, "maxGenerationAttempts must be at least maxBlueprints * maxCandidatesPerBlueprint"],
    [Number.isFinite(limits.maxEstimatedBudgetUsd) && limits.maxEstimatedBudgetUsd > 0, "maxEstimatedBudgetUsd must be > 0"],
    [limits.maxEstimatedBudgetUsd <= 50, "maxEstimatedBudgetUsd above $50 requires deliberately raising this check..."]
  ];
  const failures = checks.filter(([passed]) => !passed).map(([, message]) => message);
  if (failures.length > 0) {
    throw new Error(`Invalid generation limits: ${failures.join("; ")}`);
  }
}
```

**Budget calculation:** happens in `generationPipeline.ts` (§4), not here — this file only defines and validates the *ceiling*. The running total is a plain sum of each call's `AiResultMetadata.estimatedCostUsd`.

**Retry limits:** `maxRetries` is the one field that is both validated here *and* actually wired through — every `generateStructured()` call in the pipeline receives `options.maxRetries: limits.maxRetries`.

**Circuit-breaker behavior:** reactive — `overBudget()` in `generationPipeline.ts` is checked *before* the reverification and judge calls, not during any call, and not before the initial generation call (which has no prior spend to check against).

**What could still bypass it — the most significant finding in this review:**

1. **The circuit breaker silently disables itself for any model not in the pricing table.** `trackCost()` in `generationPipeline.ts` is `if (metadata?.estimatedCostUsd) runningCostUsd += metadata.estimatedCostUsd`. `estimatedCostUsd` is `null` — not `0` — for any model `@ipmat/ai`'s `costEstimation.ts` pricing table doesn't recognize (already flagged as a staleness risk in [PHASE_REVIEW.md](PHASE_REVIEW.md) §9.10, but not this specific consequence). If `null`, `runningCostUsd` is never incremented for that call, `overBudget()` can never return `true`, and **the entire budget circuit breaker becomes a permanent no-op** for that provider/model combination — regardless of how much is actually being spent. Swapping to a new model string, a fine-tuned model, or simply a typo in the model name passed to `AnthropicProvider` would silently disable this safety feature with no error, warning, or test that would catch it.
2. **`maxBlueprints`/`maxCandidatesPerBlueprint`/`maxGenerationAttempts` are validated for internal consistency but not currently enforced by any loop**, because no loop exists yet (§4 point 1). They are real, tested guard rails for a batch orchestrator that doesn't exist — accurate to call them "required and validated" (per the Phase 3.1 brief), inaccurate to imply they currently bound anything at runtime.
3. **The realistic worst-case-per-call cost is actually bounded by a fact that lives in a completely different file and isn't cross-referenced anywhere.** `AnthropicProvider.complete()` (`packages/ai/src/providers/anthropicProvider.ts`) hardcodes `max_tokens: 4096` on every real API call. That means a real call's output cost is capped near 4096 tokens × the model's per-token output price (for `claude-sonnet-5`, on the order of $0.06), not the unbounded blow-out the test in §4/§9 simulates with a mock reporting 10 million tokens. **This is a load-bearing safety property that `generationLimits.ts` neither knows about nor depends on being true** — if `AnthropicProvider`'s `max_tokens` were ever raised or made configurable without someone remembering this implicit coupling, the "one call can exceed the whole budget" weakness would become far more real than today's test scenario suggests, and nothing would flag the change as security-relevant.

**Does the test prove the invariant?** `generationLimits.test.ts` thoroughly exercises `validateGenerationLimits()` — every individual rule, and that all violations are listed at once, not just the first. `generationPipeline.test.ts`'s budget test uses `model: "claude-sonnet-5"` specifically (a *recognized* model), so cost tracking works and the breaker fires as designed — **but this means no test anywhere exercises the "unrecognized model → breaker silently disabled" scenario described in finding 1**, which is the most consequential gap surfaced in this entire review.

---

## 7. `runRealAnthropicSmokeTest.ts` — the unrun script

**Current code** (`packages/domain/question-engine/demo/runRealAnthropicSmokeTest.ts`, key portions):

```ts
function loadRootEnvIfPresent(): void {
  const here = dirname(fileURLToPath(import.meta.url));
  const rootEnvPath = resolve(here, "../../../../.env");
  if (!existsSync(rootEnvPath)) return;
  const content = readFileSync(rootEnvPath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (!(key in process.env)) process.env[key] = value;
  }
}

async function main() {
  loadRootEnvIfPresent();
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("FAILURE: ANTHROPIC_API_KEY is not set (checked process.env and root .env).");
    console.error("This smoke test does NOT fall back to FixtureProvider — refusing to run.");
    process.exitCode = 1;
    return;
  }
  const provider = new AnthropicProvider("claude-sonnet-5");
  // ... Task 1: generateStructured<ExaminerLensAnalysisAiOutput>(provider, {
  //       task: "examiner-lens-analysis", ...,
  //       userPrompt: buildLensRegenerationUserPrompt({ conceptName, conceptDescription, neighborConcepts }),
  //       schema: examinerLensAnalysisAiSchema, options: { maxRetries: 2, timeoutMs: 60_000 } })
  // ... Task 2: runGenerationPipeline({ blueprint: demoBlueprint, aiProvider: provider, ... })
}
```

**Provider invocation:** `new AnthropicProvider("claude-sonnet-5")` — no live-call parameters beyond model name; per-call `maxRetries`/`timeoutMs` are set at each `generateStructured` call site (2/60s for the Lens task; whatever `DEFAULT_SINGLE_RUN_LIMITS` supplies for the pipeline task, since `runGenerationPipeline` is called without an explicit `limits` override).

**Schema handling:** Task 1 uses `generateStructured<ExaminerLensAnalysisAiOutput>(...)` with an explicit type parameter — this is the exact call shape that exposed the `ZodSchema<T>` bug (§ D-026 in DECISIONS.md); its presence here, now fixed, is effectively a regression guard for that bug the moment this script actually runs.

**Error handling:** two independent `try`/`catch` blocks — a failure in the Lens task does not prevent the generation-pipeline task from being attempted; each failure is printed with `error.message` and, if it's an `AiGenerationError`, its `.metadata` is also printed.

**What exactly will be sent to Anthropic:**
- Task 1: the real "Percentages" concept name and description, plus every neighbor concept's real name and description (but not their relationship types or rationale) — see `buildLensRegenerationUserPrompt` (§8).
- Task 2 (generation call): the full `demoBlueprint` — concept, pattern family, target skill, difficulty tier, combination concepts, testing modes, trap code, transformation description, expected time, answer format.
- Task 2 (reverification call): only the generated candidate's `stem`/`options`/`answerFormat`, per `PresentedQuestionView`.
- Task 2 (judge call): the same plus `claimedDifficultyTier`, per `JudgeView` — never the claimed answer.

**What could still bypass it / concerns:**

1. **The `.env` parser is minimal and has zero test coverage.** No unit test exercises `loadRootEnvIfPresent()` — a malformed line, a value containing an unescaped `#` (which this parser has no way to distinguish from a trailing comment, since it only skips lines *starting* with `#`, not `#` appearing mid-line) would only be discovered by actually running the script.
2. **Never logs the key itself — confirmed by reading every `console.log`/`console.error` call site — but the SDK's own error messages are outside this script's control.** If a real authentication failure ever causes the Anthropic SDK to include request details (headers, etc.) in a thrown error's `.message`, `console.error(error.message)` in the catch blocks would print whatever the SDK put there. This can't be verified statically; it should be checked the first time this script is actually run with a real (or deliberately invalid) key.
3. **`real-smoke-test-output.json` is written unconditionally and is not `.gitignore`d specifically.** Nothing in it is secret (question content and metadata only), but a future `git add -A` after running this script would pick it up unless someone remembers to exclude or delete it.
4. **Zero automated test coverage of this file.** It is, by nature, only exercisable with a real API key, so this is expected rather than a gap in rigor — but it means every claim in this section is a *code-reading* claim, not a tested one.

---

## 8. `prompts.ts` — trust boundary per prompt

**Current code** for the two functions Phase 3.1 changed (full text already quoted in §1/§4's imports; reproduced here for the trust-boundary discussion):

```ts
export function buildReverificationUserPrompt(view: PresentedQuestionView): string {
  const lines = [`Question: ${view.stem}`];
  if (view.answerFormat === "multiple_choice" && view.options) {
    lines.push("Options:");
    view.options.forEach((option, i) => lines.push(`${String.fromCharCode(65 + i)}. ${option}`));
    lines.push("Determine which option is correct.");
  } else {
    lines.push("This is a numeric-entry question. Compute the exact numeric answer.");
  }
  return lines.join("\n");
}

export function buildJudgeUserPrompt(view: JudgeView): string {
  const lines = [`Claimed difficulty tier: ${view.claimedDifficultyTier}`, `Stem: ${view.stem}`];
  if (view.answerFormat === "multiple_choice" && view.options) {
    lines.push("Options:");
    view.options.forEach((option, i) => lines.push(`${String.fromCharCode(65 + i)}. ${option}`));
  } else {
    lines.push("(numeric entry, no options)");
  }
  lines.push("Judge only the question above. Determine independently whether it has exactly one defensible correct answer — do not assume any particular answer is correct.");
  return lines.join("\n");
}
```

| Prompt | Given | Trust boundary |
|---|---|---|
| Lens regeneration (`buildLensRegenerationUserPrompt`) | Concept name/description + neighbor names/descriptions | Model is NOT told relationship types or rationale — must propose them, not echo the graph |
| Question generation (`buildGenerationUserPrompt`) | Full blueprint (concept, family, skill, difficulty, combinations, modes, trap, transformation, time, format) | Model is trusted to structure a question; explicitly NOT trusted on arithmetic (`groundTruthDerivation.computation` "will be independently recomputed") or on completeness claims |
| Answer reverification (`buildReverificationUserPrompt`) | `PresentedQuestionView` only | Model is blind to the first call's answer, explanation, computation, and reasoning entirely |
| Validation judge (`buildJudgeUserPrompt`) | `JudgeView` (adds only claimed difficulty tier) | Model is blind to the claimed answer and explanation; must independently assess defensibility |

**What could still bypass the trust boundary:**

1. **The generation system prompt was not updated to match the new enforcement scope.** `buildGenerationSystemPrompt()` still says only *"You MUST NOT change the concept, pattern family, or target skill it specifies"* — it does not mention difficulty tier, testing modes, trap, or combination concepts, even though `validateBlueprintCompliance` (§3/§4) now enforces all seven fields. The *user* prompt does state the blueprint's values as inputs to fill in, so the model isn't uninformed — but the strongest, most explicit constraint framing ("MUST NOT change X") only covers 3 of the 7 now-enforced fields. This is not a safety bug — the validator still catches every deviation regardless of what the model was told — but it's a real, fixable gap between what's enforced and what's asked for, and it will produce more rejections than necessary until the system prompt is updated to match.
2. **Stem-embedded leakage (§1 finding 1) is fundamentally a prompt-design question, not fixable by narrowing the view type further** — the reverification/judge prompts necessarily need the real stem to do their job, and the stem is exactly where an answer could hide.

**Does the test prove the trust boundary?** Yes, for the reverification and judge prompts specifically — `verifierView.test.ts` (§1, §9) proves the *rendered prompt text* excludes every field it should. There is no test asserting anything about the generation or Lens-regeneration system/user prompts' content (nor should there necessarily be — those are meant to give the model information, not withhold it), and no test catches the system-prompt/validator mismatch in finding 1 above, since that's a wording gap, not a logic bug a unit test would naturally target.

---

## 9. Tests that prove the above behavior

Full current content of the two most directly relevant test files (already read in full above; reproduced compactly here as the definitive list of what actually runs):

**`packages/domain/question-engine/test/verifierView.test.ts`** — 5 tests: exact-key-set for both view constructors; marker-string absence in both rendered prompts; stem/options presence confirmed in both rendered prompts.

**`packages/domain/question-engine/test/generationLimits.test.ts`** — 8 tests: default limits accepted; each individual invalid field rejected with a message matching that field's name; `maxGenerationAttempts` too small for `maxBlueprints × maxCandidatesPerBlueprint` rejected; budget too low/too high both rejected; all violations listed at once.

**`packages/domain/question-engine/test/generationPipeline.test.ts`** — 6 tests: full-pass → `validated`; wrong-answer → `rejected` via computation+reverification while judge alone passes; generation-failure → safe `rejected` termination; Hard-tier full-pass → `review_required`; invalid limits → throws before any AI call (proven via an empty `FixtureProvider` queue that would itself error differently if ever touched); budget-exceeded → both later checks skip with `metadata: null` and `budget_exceeded`.

**`packages/domain/question-engine/test/comparisonReport.test.ts`** — 11 tests including one per combination category plus mutual exclusivity across every AI-suggested concept.

**`packages/domain/validation/test/validateCandidate.test.ts`** — 21 tests, including the 5 new blueprint-compliance cases (§3/§4), 2 fail-closed-parsing cases, 1 supported-formats case, and the untrusted-computation-input case with the prototype-pollution-style payload.

**Aggregate:** 118 tests pass across all 7 workspaces (`typecheck`/`lint`/`build` also clean — not re-verified as part of this review since no implementation changed; last verified in the Phase 3.1 commit).

**What this test suite collectively does and does not prove**, stated once rather than repeated per section: every test above exercises real functions against real (fixture) inputs and asserts on real outputs — this is not test-theater. It proves the deterministic control flow, the type-level and prompt-level exclusion of specific fields, and the specific rejection codes for specific inputs. It does not and structurally cannot prove: that a real model's output will resemble the fixtures closely enough for any of this to matter in practice; that the name-normalization gap (§5), the `distractor_quality` dead code (§3), the unrecognized-model budget bypass (§6), or the DoS/precision concerns in `verifyComputation` (§2) don't exist — because none of those are tested, by construction, since they were found by asking "what's missing" rather than by a failing assertion.

---

## 10. Implementation concerns for human review

Ranked by how much a human should actually look at them before this pipeline is trusted with real spend or real content, independent of the fact that all 118 tests pass:

1. **The budget circuit breaker silently no-ops for any model not in the hand-maintained pricing table** (§6, finding 1). This is the single most consequential finding in this review — a safety feature that appears tested and working can become completely inert with a model-name typo or an untracked model, with no error or warning anywhere.
2. **The Lens comparison report's "invented relationship" classification has no name normalization** (§5, finding 1) — a real model returning slightly different capitalization or punctuation for a concept name would be reported as having invented a relationship it didn't invent, undermining the credibility of a report whose entire purpose is catching AI overclaiming.
3. **`verifyComputation`'s arithmetic allowlist has no bound on computation size/magnitude and an untested interaction between the allowed `,` character and mathjs's actual multi-statement grammar** (§2, findings 1–2) — worth either removing `,` from the allowlist or adding an explicit test proving its behavior is benign, plus considering a length cap and/or timeout around `evaluate()`.
4. **The budget safety story depends on an undocumented cross-file coupling**: `AnthropicProvider`'s hardcoded `max_tokens: 4096` is what actually bounds worst-case per-call cost today, not anything in `generationLimits.ts` (§6, finding 3). If either file changes without the other being reconsidered, the real risk profile changes silently.
5. **`distractor_quality` is dead code with zero test coverage** (§3, finding 2) — cheap to fix (one new fixture), worth doing before relying on it.
6. **The generation system prompt doesn't mention 4 of the 7 fields blueprint compliance now enforces** (§8, finding 1) — not a safety issue, but will cause avoidable rejections; a one-line prompt update would likely reduce them.
7. **Stem-embedded answer leakage has no mitigation anywhere** (§1, finding 1) — this is the most fundamental of the findings and the least straightforward to fix: the independent verifiers need the real stem, and the real stem is exactly where a poorly-generated question could give away its own answer. Worth a deliberate decision (accept the risk for now vs. add a "does the stem itself state the answer" check to the judge's responsibilities) rather than leaving it implicit.

Nothing above was fixed as part of producing this document, per the instruction not to modify implementation.
