import { normalizeConceptNameKey } from "@ipmat/concept-graph";
import {
  ALL_RELATION_TYPES,
  isValidPackKey,
  ORDERING_RELATION_TYPES,
  RELATION_TYPE_SEMANTICS
} from "./semantics.js";
import {
  EXTERNAL_REFERENCE_PREFIX,
  type ExamPack,
  type ExamPackIssue,
  type ExamPackIssueCode,
  type ExamPackValidationResult,
  type PackProvenance
} from "./types.js";

const EXAM_CODE_PATTERN = /^[A-Z][A-Z0-9_]*$/;
const PROVENANCE_KINDS = ["canonical", "authored", "imported", "inferred"];
const REVIEW_STATES = ["unvalidated", "reviewed"];
const CONCEPT_STATUSES = ["draft", "curated", "ai_assisted", "published"];
const IMPORTANCE_LEVELS = ["core", "supporting", "peripheral"];
const REQUIREMENT_LEVELS = ["required", "optional", "contextual"];
const CERTAINTIES = ["confirmed", "probable", "speculative"];
const RELATION_SOURCES = ["human", "ai_suggested"];

const blank = (value: unknown): boolean => typeof value !== "string" || value.trim() === "";
const isPositiveInt = (value: unknown): boolean => Number.isInteger(value) && (value as number) > 0;

class IssueCollector {
  readonly issues: ExamPackIssue[] = [];
  error(code: ExamPackIssueCode, subject: string, message: string): void {
    this.issues.push({ code, severity: "error", subject, message });
  }
  warn(code: ExamPackIssueCode, subject: string, message: string): void {
    this.issues.push({ code, severity: "warning", subject, message });
  }
}

/** Calls `onDuplicate` for every item whose key was already seen. */
function checkUnique<T>(items: T[], keyOf: (item: T) => string, onDuplicate: (item: T, key: string) => void): void {
  const seen = new Set<string>();
  for (const item of items) {
    const key = keyOf(item);
    if (seen.has(key)) onDuplicate(item, key);
    seen.add(key);
  }
}

function checkProvenance(out: IssueCollector, subject: string, p: PackProvenance | null | undefined): void {
  if (!p || typeof p !== "object") {
    out.error("invalid_provenance", subject, "provenance is missing");
    return;
  }
  if (!PROVENANCE_KINDS.includes(p.kind)) out.error("invalid_provenance", subject, `unknown provenance kind "${String(p.kind)}"`);
  if (!REVIEW_STATES.includes(p.reviewState)) out.error("invalid_provenance", subject, `unknown review state "${String(p.reviewState)}"`);
  if (blank(p.sourceRef)) out.error("invalid_provenance", subject, "provenance.sourceRef is required - every artifact must be traceable");
  if (p.kind === "imported" && blank(p.licenseRef)) {
    out.error("invalid_provenance", subject, "imported content requires a licenseRef (free-to-access is not free-to-copy)");
  }
  if (p.kind === "canonical" && p.reviewState !== "reviewed") {
    out.error("invalid_provenance", subject, "a canonical claim must have been reviewed against the official source");
  }
  if (p.reviewState === "reviewed" && blank(p.reviewedBy)) {
    out.error("invalid_provenance", subject, "a reviewed artifact must name its reviewer (reviewedBy)");
  }
  if (p.reviewState === "unvalidated" && !blank(p.reviewedBy)) {
    out.error("invalid_provenance", subject, "reviewedBy is set but reviewState is unvalidated - the review state must not be left unrecorded");
  }
}

/** Finds one cycle (as a closed key path) in a directed graph, deterministically; null when acyclic. */
export function findCycle(edges: ReadonlyArray<readonly [string, string]>): string[] | null {
  const adjacency = new Map<string, string[]>();
  for (const [from, to] of edges) {
    if (!adjacency.has(from)) adjacency.set(from, []);
    adjacency.get(from)!.push(to);
  }
  for (const targets of adjacency.values()) targets.sort();
  const state = new Map<string, 1 | 2>(); // 1 = on the current path, 2 = fully explored
  const stack: string[] = [];
  const visit = (node: string): string[] | null => {
    state.set(node, 1);
    stack.push(node);
    for (const next of adjacency.get(node) ?? []) {
      if (state.get(next) === 1) return [...stack.slice(stack.indexOf(next)), next];
      if (!state.has(next)) {
        const found = visit(next);
        if (found) return found;
      }
    }
    stack.pop();
    state.set(node, 2);
    return null;
  };
  for (const node of [...adjacency.keys()].sort()) {
    if (!state.has(node)) {
      const found = visit(node);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Validates one Exam Pack. Deterministic, total (does not throw on a
 * malformed pack) and side-effect free. A pack with any `error` issue is not
 * valid; `service.ts` refuses to answer graph queries from an invalid pack.
 */
export function validateExamPack(pack: ExamPack): ExamPackValidationResult {
  const out = new IssueCollector();

  if (blank(pack.examCode) || !EXAM_CODE_PATTERN.test(pack.examCode)) {
    out.error("invalid_exam_code", String(pack.examCode), "examCode must be UPPER_SNAKE_CASE");
  }
  if (blank(pack.packVersion) || blank(pack.name)) {
    out.error("invalid_pack_identity", String(pack.examCode), "packVersion and name are required");
  }
  checkProvenance(out, `pack ${pack.examCode}`, pack.provenance);

  // --- sections ---
  const sectionKeys = new Set<string>();
  for (const s of pack.sections) {
    const subject = `section ${s.key}`;
    if (!isValidPackKey(s.key)) out.error("invalid_key", subject, "key must be lowercase alphanumeric segments joined by - or /");
    if (blank(s.name)) out.error("invalid_pack_identity", subject, "section name is required");
    if (!isPositiveInt(s.order)) out.error("invalid_order", subject, "order must be a positive integer");
    checkProvenance(out, subject, s.provenance);
    sectionKeys.add(s.key);
  }
  checkUnique(pack.sections, (s) => s.key, (s) => out.error("duplicate_key", `section ${s.key}`, "duplicate section key"));
  checkUnique(pack.sections, (s) => normalizeConceptNameKey(String(s.name)), (s) => out.error("duplicate_name", `section ${s.key}`, `duplicate section name "${s.name}"`));
  checkUnique(pack.sections, (s) => String(s.order), (s) => out.error("duplicate_order", `section ${s.key}`, `duplicate section order ${s.order}`));

  // --- syllabus hierarchy ---
  const nodesByKey = new Map(pack.syllabus.map((n) => [n.key, n]));
  for (const n of pack.syllabus) {
    const subject = `syllabus node ${n.key}`;
    if (!isValidPackKey(n.key)) out.error("invalid_key", subject, "key must be lowercase alphanumeric segments joined by - or /");
    if (blank(n.name)) out.error("invalid_pack_identity", subject, "syllabus node name is required");
    if (!isPositiveInt(n.order)) out.error("invalid_order", subject, "order must be a positive integer");
    checkProvenance(out, subject, n.provenance);
    if (!sectionKeys.has(n.sectionKey)) out.error("unknown_section", subject, `references unknown section "${n.sectionKey}"`);
    if (n.parentKey !== null) {
      const parent = nodesByKey.get(n.parentKey);
      if (!parent) out.error("invalid_hierarchy", subject, `parent "${n.parentKey}" does not exist`);
      else if (parent.sectionKey !== n.sectionKey) out.error("invalid_hierarchy", subject, `parent "${n.parentKey}" belongs to a different section`);
    }
  }
  checkUnique(pack.syllabus, (n) => n.key, (n) => out.error("duplicate_key", `syllabus node ${n.key}`, "duplicate syllabus node key"));
  checkUnique(pack.syllabus, (n) => `${n.sectionKey}|${n.parentKey ?? ""}|${normalizeConceptNameKey(String(n.name))}`, (n) =>
    out.error("duplicate_name", `syllabus node ${n.key}`, `duplicate sibling name "${n.name}"`)
  );
  checkUnique(pack.syllabus, (n) => `${n.sectionKey}|${n.parentKey ?? ""}|${n.order}`, (n) =>
    out.error("duplicate_order", `syllabus node ${n.key}`, `duplicate sibling order ${n.order}`)
  );
  const hierarchyCycle = findCycle(pack.syllabus.filter((n) => n.parentKey !== null).map((n) => [n.key, n.parentKey as string] as const));
  if (hierarchyCycle) out.error("syllabus_cycle", `syllabus node ${hierarchyCycle[0]}`, `syllabus hierarchy contains a cycle: ${hierarchyCycle.join(" -> ")}`);

  // --- concepts ---
  const conceptKeys = new Set<string>();
  for (const c of pack.concepts) {
    const subject = `concept ${c.key}`;
    if (!isValidPackKey(c.key)) out.error("invalid_key", subject, "key must be lowercase alphanumeric segments joined by - or /");
    if (blank(c.name)) out.error("malformed_concept", subject, "concept name is required");
    if (blank(c.description)) out.error("malformed_concept", subject, "concept description is required");
    if (!CONCEPT_STATUSES.includes(c.status)) out.error("malformed_concept", subject, `unknown status "${String(c.status)}"`);
    if (!nodesByKey.has(c.syllabusNodeKey)) out.error("unknown_syllabus_node", subject, `located under unknown syllabus node "${c.syllabusNodeKey}"`);
    if (c.skills.some(blank) || new Set(c.skills.map(normalizeConceptNameKey)).size !== c.skills.length) {
      out.error("malformed_concept", subject, "skills must be non-empty and unique");
    }
    if (c.patternFamilyRefs.some(blank) || new Set(c.patternFamilyRefs.map(normalizeConceptNameKey)).size !== c.patternFamilyRefs.length) {
      out.error("malformed_concept", subject, "patternFamilyRefs must be non-empty and unique");
    }
    if (c.importance !== null && (!IMPORTANCE_LEVELS.includes(c.importance.level) || blank(c.importance.rationale))) {
      out.error("malformed_concept", subject, "importance requires a known level and a non-empty rationale - it is only present where justified");
    }
    checkProvenance(out, subject, c.provenance);
    conceptKeys.add(c.key);
  }
  checkUnique(pack.concepts, (c) => c.key, (c) => out.error("duplicate_key", `concept ${c.key}`, "duplicate concept key"));
  checkUnique(pack.concepts, (c) => normalizeConceptNameKey(String(c.name)), (c) =>
    out.error("duplicate_concept", `concept ${c.key}`, `duplicate concept name "${c.name}" (compared after normalization)`)
  );

  // --- relations ---
  const touched = new Set<string>();
  const seenEdges = new Set<string>();
  for (const r of pack.relations) {
    const subject = `relation ${r.from} -[${r.type}]-> ${r.to}`;
    let endpointsOk = true;
    for (const [role, key] of [["from", r.from], ["to", r.to]] as const) {
      if (typeof key === "string" && key.startsWith(EXTERNAL_REFERENCE_PREFIX)) {
        out.error("cross_exam_relation", subject, `${role} endpoint "${key}" is outside this exam pack`);
        endpointsOk = false;
      } else if (!conceptKeys.has(key)) {
        out.error("unknown_concept", subject, `${role} endpoint "${String(key)}" is not a concept in this pack`);
        endpointsOk = false;
      }
    }
    if (!ALL_RELATION_TYPES.includes(r.type)) {
      out.error("malformed_relation", subject, `unknown relation type "${String(r.type)}"`);
      continue;
    }
    if (blank(r.rationale) || blank(r.sharedKnowledge)) out.error("malformed_relation", subject, "rationale and sharedKnowledge are required - never a bare label");
    if (!REQUIREMENT_LEVELS.includes(r.requirementLevel) || !CERTAINTIES.includes(r.certainty) || !RELATION_SOURCES.includes(r.source)) {
      out.error("malformed_relation", subject, "requirementLevel, certainty and source must be known values");
    }
    if (typeof r.usefulForQuestionGeneration !== "boolean") out.error("malformed_relation", subject, "usefulForQuestionGeneration must be boolean");
    if (r.from === r.to) out.error("self_relation", subject, "a concept cannot be related to itself");
    checkProvenance(out, subject, r.provenance);
    if (r.provenance) {
      if ((r.source === "ai_suggested") !== (r.provenance.kind === "inferred")) {
        out.error("provenance_source_mismatch", subject, `source "${r.source}" disagrees with provenance kind "${r.provenance.kind}"`);
      }
      if (r.certainty === "confirmed" && r.provenance.kind === "inferred" && r.provenance.reviewState !== "reviewed") {
        out.error("unreviewed_inference_promoted", subject, "an inferred relationship cannot be 'confirmed' until a person has reviewed it");
      }
    }
    const exactKey = `${r.from}|${r.to}|${r.type}`;
    if (seenEdges.has(exactKey)) out.error("duplicate_relation", subject, "the same (from, to, type) relation appears more than once");
    else if (RELATION_TYPE_SEMANTICS[r.type].symmetric && seenEdges.has(`${r.to}|${r.from}|${r.type}`)) {
      out.error("duplicate_symmetric_relation", subject, `${r.type} is symmetric; the reverse edge already states the same claim`);
    }
    seenEdges.add(exactKey);
    if (endpointsOk) {
      touched.add(r.from);
      touched.add(r.to);
    }
  }

  // --- forbidden cycles: per ordering type, then the union (only reported if no single type explains it) ---
  const resolvable = pack.relations.filter((r) => conceptKeys.has(r.from) && conceptKeys.has(r.to) && r.from !== r.to);
  let perTypeCycle = false;
  for (const type of ORDERING_RELATION_TYPES) {
    const cycle = findCycle(resolvable.filter((r) => r.type === type).map((r) => [r.from, r.to] as const));
    if (cycle) {
      perTypeCycle = true;
      out.error("forbidden_cycle", `${type} relations`, `${type} is an ordering relation and cannot be cyclic: ${cycle.join(" -> ")}`);
    }
  }
  if (!perTypeCycle) {
    const cycle = findCycle(resolvable.filter((r) => ORDERING_RELATION_TYPES.includes(r.type)).map((r) => [r.from, r.to] as const));
    if (cycle) out.error("forbidden_cycle", "ordering relations", `prerequisite/foundational/advanced_extension together cannot be cyclic: ${cycle.join(" -> ")}`);
  }

  // --- terminology ---
  for (const t of pack.terminology) {
    const subject = `term "${t.term}"`;
    if (blank(t.term) || blank(t.definition)) out.error("malformed_term", subject, "term and definition are required");
    if (t.conceptKey !== null && !conceptKeys.has(t.conceptKey)) out.error("unknown_concept", subject, `references unknown concept "${t.conceptKey}"`);
    checkProvenance(out, subject, t.provenance);
  }
  checkUnique(pack.terminology, (t) => normalizeConceptNameKey(String(t.term)), (t) => out.error("duplicate_name", `term "${t.term}"`, "duplicate terminology entry"));

  for (const c of pack.concepts) {
    if (!touched.has(c.key)) out.warn("isolated_concept", `concept ${c.key}`, "concept has no valid relationships");
  }

  return { valid: !out.issues.some((i) => i.severity === "error"), issues: out.issues };
}

/**
 * Validates a SET of packs: each pack on its own, distinct exam codes, and
 * cross-exam isolation - a relation endpoint that does not resolve in its own
 * pack but DOES exist in another one is reported as `cross_exam_relation`.
 */
export function validateExamPackSet(packs: readonly ExamPack[]): Map<string, ExamPackValidationResult> {
  const results = new Map<string, ExamPackValidationResult>();
  const seenCodes = new Set<string>();
  for (const pack of packs) {
    const issues = [...validateExamPack(pack).issues];
    if (seenCodes.has(pack.examCode)) {
      issues.push({ code: "duplicate_exam_code", severity: "error", subject: pack.examCode, message: "two packs declare the same examCode" });
    }
    seenCodes.add(pack.examCode);
    const own = new Set(pack.concepts.map((c) => c.key));
    const foreign = new Set(packs.filter((p) => p !== pack).flatMap((p) => p.concepts.map((c) => c.key)));
    for (const r of pack.relations) {
      for (const key of [r.from, r.to]) {
        if (!own.has(key) && !key.startsWith(EXTERNAL_REFERENCE_PREFIX) && foreign.has(key)) {
          issues.push({
            code: "cross_exam_relation",
            severity: "error",
            subject: `relation ${r.from} -[${r.type}]-> ${r.to}`,
            message: `endpoint "${key}" belongs to a different exam pack`
          });
        }
      }
    }
    results.set(pack.examCode, { valid: !issues.some((i) => i.severity === "error"), issues });
  }
  return results;
}
