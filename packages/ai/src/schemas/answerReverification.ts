import { z } from "zod";

/**
 * Task: "answer-reverification". A SECOND, independent AI call given only
 * the question stem (never the first candidate's stated answer or
 * reasoning) — asked to solve the question from scratch. The pipeline
 * compares this against both the first candidate's stated answer and the
 * deterministic recomputation; agreement across all three is what "final
 * system must compare generated vs. independently derived" means here
 * (docs/QUESTION_ENGINE.md §5a). No self-reported confidence field — this
 * package never encodes anything resembling a confidence score, even an
 * AI's own, to keep it unambiguous that this project has none anywhere
 * (docs/DECISIONS.md D-005).
 */
export const answerReverificationAiSchema = z.object({
  derivedAnswer: z.string().min(1),
  derivationSteps: z.array(z.string().min(1)).min(1)
});

export type AnswerReverificationAiOutput = z.infer<typeof answerReverificationAiSchema>;
