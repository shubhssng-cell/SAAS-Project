import { SimulationError, type SimulationConfig } from "./types.js";

const isPositiveInt = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n > 0;
const nonEmpty = (s: unknown): s is string => typeof s === "string" && s.trim().length > 0;

/**
 * Lists every problem with a configuration (empty = valid). Pure. It checks that the configuration is internally
 * consistent and complete; it never decides what an exam's real rules are - that is the supplier's responsibility,
 * which is why `provenance` is mandatory and a `canonical` configuration must be reviewed.
 */
export function simulationConfigProblems(config: SimulationConfig): string[] {
  const problems: string[] = [];
  if (!nonEmpty(config.examCode)) problems.push("examCode_required");
  if (!nonEmpty(config.configVersion)) problems.push("configVersion_required");
  if (!isPositiveInt(config.overallDurationSeconds)) problems.push("overallDurationSeconds_must_be_a_positive_integer");
  if (!Array.isArray(config.sections) || config.sections.length === 0) {
    problems.push("at_least_one_section_required");
  } else {
    const names = new Set<string>();
    const orders = new Set<number>();
    for (const [i, s] of config.sections.entries()) {
      if (!nonEmpty(s.sectionName)) problems.push(`section_${i}_sectionName_required`);
      else if (names.has(s.sectionName)) problems.push(`duplicate_sectionName:${s.sectionName}`);
      else names.add(s.sectionName);
      if (!isPositiveInt(s.order)) problems.push(`section_${i}_order_must_be_a_positive_integer`);
      else if (orders.has(s.order)) problems.push(`duplicate_section_order:${s.order}`);
      else orders.add(s.order);
      if (!isPositiveInt(s.questionCount)) problems.push(`section_${i}_questionCount_must_be_a_positive_integer`);
    }
  }
  const p = config.provenance;
  if (!p || !nonEmpty(p.sourceRef)) problems.push("provenance_sourceRef_required");
  else {
    if (p.reviewState === "reviewed" && !nonEmpty(p.reviewedBy)) problems.push("reviewed_configuration_requires_reviewedBy");
    if (p.kind === "canonical" && p.reviewState !== "reviewed") problems.push("canonical_configuration_must_be_reviewed");
  }
  return problems;
}

export function assertValidSimulationConfig(config: SimulationConfig): void {
  const problems = simulationConfigProblems(config);
  if (problems.length > 0) throw new SimulationError("invalid_config", "The simulation configuration is invalid.", problems);
}

/** Sections in their declared order. */
export function orderedSections(config: SimulationConfig): SimulationConfig["sections"] {
  return [...config.sections].sort((a, b) => a.order - b.order);
}

/** Total questions the paper must hold. */
export function totalQuestionCount(config: SimulationConfig): number {
  return config.sections.reduce((sum, s) => sum + s.questionCount, 0);
}
