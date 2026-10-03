import { assertValidSimulationConfig, orderedSections } from "./config.js";
import { SimulationError, type PaperCandidate, type PaperQuestion, type PaperSelection, type SimulationConfig, type SimulationPaper } from "./types.js";

/**
 * Builds a paper from an editor's EXPLICIT selection of questions, deterministically and fail-closed. The engine never
 * chooses questions: automatic composition (which questions, what difficulty mix) is not specified anywhere, and no
 * real historical paper exists, so a paper is always `assembled` and `isHistoricalPaper` is always false.
 *
 * Every question must be: named exactly once; present in the supplied exam-scoped candidates; published; of this exam;
 * in the section it is placed in; and carry provenance. Each section must hold exactly its configured question count and
 * no section outside the configuration may appear. Positions are 1-based and contiguous in section order, then in the
 * order the selection lists them. Every problem found is reported together.
 */
export function assemblePaper(config: SimulationConfig, selection: PaperSelection, candidates: readonly PaperCandidate[]): SimulationPaper {
  assertValidSimulationConfig(config);
  const problems: string[] = [];
  const byId = new Map(candidates.map((c) => [c.questionId, c]));
  const configured = new Set(config.sections.map((s) => s.sectionName));

  if (selection.origin !== "assembled") problems.push("paper_origin_must_be_assembled");
  if (typeof selection.sourceRef !== "string" || selection.sourceRef.trim().length === 0) problems.push("paper_sourceRef_required");
  for (const name of Object.keys(selection.sections)) if (!configured.has(name)) problems.push(`section_not_in_configuration:${name}`);

  const seen = new Set<string>();
  const questions: PaperQuestion[] = [];
  let position = 0;
  for (const section of orderedSections(config)) {
    const ids = selection.sections[section.sectionName] ?? [];
    if (ids.length !== section.questionCount) problems.push(`section_${section.sectionName}_needs_${section.questionCount}_questions_got_${ids.length}`);
    for (const id of ids) {
      position += 1;
      if (seen.has(id)) {
        problems.push(`duplicate_question:${id}`);
        continue;
      }
      seen.add(id);
      const c = byId.get(id);
      if (!c) {
        problems.push(`question_not_found_for_this_exam:${id}`);
        continue;
      }
      if (c.examCode !== config.examCode) problems.push(`question_of_another_exam:${id}`);
      if (c.validationState !== "published") problems.push(`question_not_published:${id}`);
      if (c.sectionName !== section.sectionName) problems.push(`question_in_wrong_section:${id}`);
      if (c.sourceType === null || c.sourceType.length === 0) problems.push(`question_without_provenance:${id}`);
      questions.push({ position, sectionName: section.sectionName, questionId: id, contentFingerprint: c.contentFingerprint, provenanceSourceType: c.sourceType ?? "" });
    }
  }
  if (problems.length > 0) throw new SimulationError("invalid_paper", "The simulation paper cannot be assembled.", problems);
  return { origin: "assembled", isHistoricalPaper: false, sourceRef: selection.sourceRef, questions };
}
