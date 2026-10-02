import { normalizeConceptNameKey } from "@ipmat/concept-graph";
import { validateDnaClassification, type HistoricalDnaClassification } from "@ipmat/examiner-intelligence";
import { VALIDATED_STATES, type ContentBasis, type ContentQuestionView, type ExamIntelligenceSnapshot } from "./types.js";

/**
 * Data quality (docs/DECISIONS.md D-086). Every question is assigned exactly
 * ONE disposition, and the reasons are kept. Nothing is silently counted or
 * silently dropped, and no default is invented to make bad metadata usable:
 * a question with missing, invalid, contradictory or cross-exam metadata is
 * EXCLUDED and says why.
 *
 * Order of checks (first match wins, so a question is counted in one place):
 *  1. cross-exam      its DNA names another exam
 *  2. fixture         synthetic test content (unless explicitly included)
 *  3. rejected        a rejected question is never content
 *  4. invalid metadata missing/unknown/contradictory DNA (Prompt 2/3 validation, unchanged)
 *  5. duplicate       the same logical question (content fingerprint) already counted; the
 *                     highest lifecycle tier is kept, ties broken by id
 *  otherwise counted.
 */
export type QuestionDisposition = "counted" | "excluded_cross_exam" | "excluded_fixture" | "excluded_rejected" | "excluded_invalid_metadata" | "excluded_duplicate";

export interface QuestionAssessment {
  id: string;
  disposition: QuestionDisposition;
  /** Machine-readable reasons (validation issue codes, or the id of the question this duplicates). */
  reasons: string[];
  /** The highest content tier this counted question reaches; null when excluded. */
  tier: ContentBasis | null;
}

export interface AssessmentOptions {
  /** Count synthetic fixtures. Default false. */
  includeFixtures?: boolean;
}

const RANK: Record<ContentBasis, number> = { available: 0, validated: 1, published: 2 };

export function tierOf(view: Pick<ContentQuestionView, "validationState">): ContentBasis {
  return view.validationState === "published" ? "published" : VALIDATED_STATES.includes(view.validationState) ? "validated" : "available";
}

/** Assigns every question a disposition. Deterministic: independent of input order. */
export function assessQuestions(snapshot: ExamIntelligenceSnapshot, options: AssessmentOptions = {}): QuestionAssessment[] {
  const out = new Map<string, QuestionAssessment>();
  const survivors: ContentQuestionView[] = [];
  const ordered = [...snapshot.questions].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  for (const q of ordered) {
    if (!q.dna || q.dna.examCode !== snapshot.examCode) {
      out.set(q.id, { id: q.id, disposition: "excluded_cross_exam", reasons: [`dna.examCode=${String(q.dna?.examCode)}`], tier: null });
    } else if (q.isFixture && !options.includeFixtures) {
      out.set(q.id, { id: q.id, disposition: "excluded_fixture", reasons: ["synthetic test content"], tier: null });
    } else if (q.validationState === "rejected") {
      out.set(q.id, { id: q.id, disposition: "excluded_rejected", reasons: ["rejected"], tier: null });
    } else {
      let issues: Array<{ code: string; field: string }>;
      try {
        issues = validateDnaClassification(q.dna as unknown as HistoricalDnaClassification, { pack: snapshot.pack, patternFamilies: snapshot.patternFamilies, errorTaxonomyCodes: snapshot.errorTaxonomyCodes });
      } catch {
        issues = [{ code: "malformed_metadata", field: "dna" }];
      }
      if (issues.length > 0) out.set(q.id, { id: q.id, disposition: "excluded_invalid_metadata", reasons: [...new Set(issues.map((i) => i.code))].sort(), tier: null });
      else survivors.push(q);
    }
  }

  // Duplicates: among valid questions sharing a fingerprint, keep the highest tier (ties: lowest id).
  const byFingerprint = new Map<string, ContentQuestionView[]>();
  for (const q of survivors) {
    if (q.fingerprint === null) continue;
    const list = byFingerprint.get(q.fingerprint) ?? [];
    list.push(q);
    byFingerprint.set(q.fingerprint, list);
  }
  const loser = new Map<string, string>();
  for (const group of byFingerprint.values()) {
    if (group.length < 2) continue;
    const keep = [...group].sort((a, b) => RANK[tierOf(b)] - RANK[tierOf(a)] || (a.id < b.id ? -1 : 1))[0]!;
    for (const q of group) if (q.id !== keep.id) loser.set(q.id, keep.id);
  }
  for (const q of survivors) {
    const keeper = loser.get(q.id);
    out.set(q.id, keeper ? { id: q.id, disposition: "excluded_duplicate", reasons: [`duplicate of ${keeper}`], tier: null } : { id: q.id, disposition: "counted", reasons: [], tier: tierOf(q) });
  }
  return [...out.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
}

export interface QualifiedQuestion {
  view: ContentQuestionView;
  tier: ContentBasis;
  /** The canonical pack concept name this question's primary concept resolves to. */
  conceptName: string;
}

/** The counted questions, optionally limited to a content basis (published ⊂ validated ⊂ available). */
export function qualifiedQuestions(snapshot: ExamIntelligenceSnapshot, assessments: readonly QuestionAssessment[], basis: ContentBasis): QualifiedQuestion[] {
  const byId = new Map(snapshot.questions.map((q) => [q.id, q]));
  const concepts = new Map(snapshot.pack.concepts.map((c) => [normalizeConceptNameKey(c.name), c.name]));
  const out: QualifiedQuestion[] = [];
  for (const a of assessments) {
    if (a.disposition !== "counted" || a.tier === null || RANK[a.tier] < RANK[basis]) continue;
    const view = byId.get(a.id);
    const conceptName = view ? concepts.get(normalizeConceptNameKey(view.dna.conceptName)) : undefined;
    if (view && conceptName) out.push({ view, tier: a.tier, conceptName });
  }
  return out;
}

export interface AssessmentSummary {
  total: number;
  counted: number;
  excluded: Record<Exclude<QuestionDisposition, "counted">, number>;
  /** Invalid-metadata exclusions by validation code - the data-quality worklist. */
  invalidMetadataCodes: Array<{ code: string; count: number }>;
  tiers: Record<ContentBasis, number>;
  /** How many counted questions had no fingerprint, i.e. could NOT be checked for duplicates. */
  duplicateCheckUnavailable: number;
}

export function summarizeAssessments(snapshot: ExamIntelligenceSnapshot, assessments: readonly QuestionAssessment[]): AssessmentSummary {
  const excluded = { excluded_cross_exam: 0, excluded_fixture: 0, excluded_rejected: 0, excluded_invalid_metadata: 0, excluded_duplicate: 0 };
  const codes = new Map<string, number>();
  const tiers: Record<ContentBasis, number> = { available: 0, validated: 0, published: 0 };
  let counted = 0;
  const byId = new Map(snapshot.questions.map((q) => [q.id, q]));
  let unchecked = 0;
  for (const a of assessments) {
    if (a.disposition === "counted" && a.tier) {
      counted += 1;
      tiers.available += 1;
      if (RANK[a.tier] >= 1) tiers.validated += 1;
      if (RANK[a.tier] >= 2) tiers.published += 1;
      if (byId.get(a.id)?.fingerprint === null) unchecked += 1;
    } else if (a.disposition !== "counted") {
      excluded[a.disposition] += 1;
      if (a.disposition === "excluded_invalid_metadata") for (const r of a.reasons) codes.set(r, (codes.get(r) ?? 0) + 1);
    }
  }
  return { total: assessments.length, counted, excluded, invalidMetadataCodes: [...codes.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([code, count]) => ({ code, count })), tiers, duplicateCheckUnavailable: unchecked };
}
