/**
 * Resolves `Exam.examDateRule` (persisted JSON, see docs/DATABASE.md) into
 * the concrete date string `computePrepPhase()` needs. Only `"fixed_date"`
 * exists as a rule type in this vertical slice (see
 * `../fixtures/ipmatTemplate.ts` and `packages/db/prisma/seed.ts`, which
 * both encode IPMAT's exam date this exact way) — this function fails
 * closed (throws) for anything else, rather than guessing at a rule shape
 * nothing has defined yet. This is generic parsing logic, not a
 * hard-coded exam date: the actual date always comes from the persisted
 * row, never from this file.
 */
export class ExamDateRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExamDateRuleError";
  }
}

export function resolveExamDate(examDateRule: unknown): string {
  if (typeof examDateRule !== "object" || examDateRule === null) {
    throw new ExamDateRuleError("Malformed exam date rule.");
  }
  const { type, date } = examDateRule as Record<string, unknown>;
  if (type !== "fixed_date" || typeof date !== "string" || date.trim() === "") {
    throw new ExamDateRuleError(`Unsupported or malformed exam date rule: ${JSON.stringify(examDateRule)}`);
  }
  return date;
}
