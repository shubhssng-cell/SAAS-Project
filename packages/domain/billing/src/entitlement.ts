import { FEATURE_IDS, METER_IDS, findPlan, METER_FEATURE, type AccessBaseline, type FeatureId, type MeterId, type PlanCatalog, type UsageLimit, type UsagePeriod } from "./catalog.js";
import { effectiveStatus, grantsAccess, type Subscription, type SubscriptionStatus } from "./subscription.js";

/**
 * Entitlement: the application's own, explicit answer to "may this student use this feature for this exam right now?"
 * (Phase 9 Unit 4, D-100).
 *
 * It is DERIVED on every call from three server-side things - the student's stored subscriptions, the plan catalog and the
 * server clock - and is never stored, cached or accepted from a request. A successful payment is not an entitlement; an
 * entitlement exists only while a subscription's status and paid period say it does. It is also not authentication (who you
 * are) and not enrollment (which exam you joined): those are separate facts checked elsewhere, and each must hold.
 *
 * Modes:
 *  - `enforced`: the rules below apply.
 *  - `open`:     no commercial restriction (today's behavior, before any plan existed). Explicit, never the silent default of a
 *                production deployment; every decision made in this mode says so (`open_access_mode`).
 */
export type EntitlementMode = "open" | "enforced";

export type DecisionReason = "open_access_mode" | "baseline" | "entitled" | "not_entitled_exam" | "not_entitled_feature" | "unknown_feature" | "staff_not_subject_to_student_billing" | "staff_only";

export interface AccessDecision {
  allowed: boolean;
  reason: DecisionReason;
}

/** One source of access: a subscription that currently grants it. */
export interface Entitlement {
  subscriptionId: string;
  planId: string;
  planName: string;
  /** The subscription status as stored (`active`, `cancelled` = will not renew, `past_due`). */
  status: SubscriptionStatus;
  /** When this entitlement ends (ISO): the end of the period that was paid for. */
  validUntil: string;
  exams: string[];
  features: FeatureId[];
  usageLimits: UsageLimit[];
}

export interface EffectiveLimit {
  meter: MeterId;
  limit: number | "unlimited";
  period: UsagePeriod;
}

export interface AccessSnapshot {
  mode: EntitlementMode;
  /** Subscription-backed sources of access that are valid right now. Does not include the baseline. */
  entitlements: Entitlement[];
  baseline: AccessBaseline;
}

/** The read side of billing state that the entitlement service needs. */
export interface SubscriptionReader {
  listSubscriptionsForStudent(studentId: string): Promise<Subscription[]>;
}

export interface EntitlementDependencies {
  mode: EntitlementMode;
  catalog: PlanCatalog;
  subscriptions: SubscriptionReader;
  now: () => Date;
}

/** Who is asking. A staff member's content permissions are decided elsewhere and are not a student's subscription. */
export type EntitlementSubject = { kind: "student"; studentId: string } | { kind: "staff" };

export class EntitlementService {
  constructor(private readonly deps: EntitlementDependencies) {}

  get mode(): EntitlementMode {
    return this.deps.mode;
  }

  /** Every currently valid subscription-backed entitlement for the student, derived now. A subscription whose plan is no longer in the catalog grants nothing (fail closed). */
  async snapshot(studentId: string, preloaded?: readonly Subscription[]): Promise<AccessSnapshot> {
    const now = this.deps.now();
    const subscriptions = preloaded ?? (await this.deps.subscriptions.listSubscriptionsForStudent(studentId));
    const entitlements: Entitlement[] = [];
    for (const s of subscriptions) {
      if (s.studentId !== studentId || !grantsAccess(s, now) || s.paidThrough === null) continue;
      const plan = findPlan(this.deps.catalog, s.planId);
      if (!plan) continue;
      entitlements.push({ subscriptionId: s.id, planId: plan.id, planName: plan.name, status: effectiveStatus(s, now), validUntil: s.paidThrough, exams: [...plan.exams], features: [...plan.features], usageLimits: plan.usageLimits.map((l) => ({ ...l })) });
    }
    return { mode: this.deps.mode, entitlements, baseline: this.deps.catalog.baseline };
  }

  /** Whether the student may use `feature` for `examCode`. The exam and the feature must be granted by the SAME source (the baseline or one subscription): access cannot be assembled by mixing two plans. */
  async decide(studentId: string, feature: FeatureId, examCode: string): Promise<AccessDecision> {
    if (this.deps.mode === "open") return { allowed: true, reason: "open_access_mode" };
    const snapshot = await this.snapshot(studentId);
    if (!examGranted(snapshot, examCode)) return { allowed: false, reason: "not_entitled_exam" };
    const sources = sourcesOf(snapshot, feature, examCode);
    if (sources.fromBaseline) return { allowed: true, reason: "baseline" };
    return sources.entitlements.length > 0 ? { allowed: true, reason: "entitled" } : { allowed: false, reason: "not_entitled_feature" };
  }

  async canAccessExam(studentId: string, examCode: string): Promise<AccessDecision> {
    if (this.deps.mode === "open") return { allowed: true, reason: "open_access_mode" };
    if (this.deps.catalog.baseline.exams.includes(examCode)) return { allowed: true, reason: "baseline" };
    const snapshot = await this.snapshot(studentId);
    return snapshot.entitlements.some((e) => e.exams.includes(examCode)) ? { allowed: true, reason: "entitled" } : { allowed: false, reason: "not_entitled_exam" };
  }

  /**
   * Everything a billing summary needs about a student's access for one exam, answered from ONE snapshot (one subscription read) -
   * the per-question methods above each take their own snapshot, which is right for a single decision but wasteful for a screen that
   * asks seven of them. `subscriptions` may be passed when the caller has already loaded them. In `open` mode nothing is restricted
   * and no limits apply.
   */
  async describeAccess(studentId: string, examCode: string, subscriptions?: readonly Subscription[]): Promise<{ exam: boolean; features: Array<{ id: FeatureId; allowed: boolean }>; limits: EffectiveLimit[] }> {
    if (this.deps.mode === "open") return { exam: true, features: FEATURE_IDS.map((id) => ({ id, allowed: true })), limits: [] };
    const snapshot = await this.snapshot(studentId, subscriptions);
    const exam = examGranted(snapshot, examCode);
    const features = FEATURE_IDS.map((id) => {
      const sources = sourcesOf(snapshot, id, examCode);
      return { id, allowed: exam && (sources.fromBaseline || sources.entitlements.length > 0) };
    });
    const limits: EffectiveLimit[] = [];
    for (const meter of METER_IDS) {
      const sources = sourcesOf(snapshot, METER_FEATURE[meter], examCode);
      const candidates: UsageLimit[] = [];
      if (sources.fromBaseline) candidates.push(...snapshot.baseline.usageLimits.filter((l) => l.meter === meter));
      for (const e of sources.entitlements) candidates.push(...e.usageLimits.filter((l) => l.meter === meter));
      const best = exam ? mostGenerous(candidates) : null;
      if (best) limits.push(best);
    }
    return { exam, features, limits };
  }

  canUseTutor(studentId: string, examCode: string): Promise<AccessDecision> {
    return this.decide(studentId, "tutor", examCode);
  }

  canTakeSimulation(studentId: string, examCode: string): Promise<AccessDecision> {
    return this.decide(studentId, "simulation", examCode);
  }

  canUseAdvancedTraining(studentId: string, examCode: string): Promise<AccessDecision> {
    return this.decide(studentId, "advanced_training", examCode);
  }

  /**
   * Question generation is a STAFF operation and is never sold: no student plan can include it (`FEATURE_IDS` has no such
   * feature), so a student is always denied here. A staff member is not blocked BY BILLING - whether they may generate is
   * decided by the orchestration authorization, not by a subscription.
   */
  canGenerateQuestion(subject: EntitlementSubject): AccessDecision {
    return subject.kind === "staff" ? { allowed: true, reason: "staff_not_subject_to_student_billing" } : { allowed: false, reason: "staff_only" };
  }

  /**
   * The usage limit that applies to `meter` for this student and exam: the most generous limit among the sources that grant the
   * metered feature for the exam (the baseline and each valid subscription), `"unlimited"` beating any number. `null` means the
   * feature is not granted at all, or the deployment is in open mode (nothing is metered).
   */
  async getUsageLimit(studentId: string, meter: MeterId, examCode: string): Promise<EffectiveLimit | null> {
    if (this.deps.mode === "open") return null;
    const snapshot = await this.snapshot(studentId);
    const sources = sourcesOf(snapshot, METER_FEATURE[meter], examCode);
    const candidates: UsageLimit[] = [];
    if (sources.fromBaseline) candidates.push(...snapshot.baseline.usageLimits.filter((l) => l.meter === meter));
    for (const e of sources.entitlements) candidates.push(...e.usageLimits.filter((l) => l.meter === meter));
    return mostGenerous(candidates);
  }
}

const examGranted = (snapshot: AccessSnapshot, examCode: string): boolean => snapshot.baseline.exams.includes(examCode) || snapshot.entitlements.some((e) => e.exams.includes(examCode));

function sourcesOf(snapshot: AccessSnapshot, feature: FeatureId, examCode: string): { fromBaseline: boolean; entitlements: Entitlement[] } {
  return {
    fromBaseline: snapshot.baseline.exams.includes(examCode) && snapshot.baseline.features.includes(feature),
    entitlements: snapshot.entitlements.filter((e) => e.exams.includes(examCode) && e.features.includes(feature))
  };
}

/** Deterministic merge: `unlimited` first, then the larger number, then the longer period (month before day). */
export function mostGenerous(limits: readonly UsageLimit[]): EffectiveLimit | null {
  const rank = (l: UsageLimit): number => (l.limit === "unlimited" ? Number.POSITIVE_INFINITY : l.limit);
  const sorted = [...limits].sort((a, b) => rank(b) - rank(a) || (a.period === b.period ? 0 : a.period === "month" ? -1 : 1));
  const best = sorted[0];
  return best ? { meter: best.meter, limit: best.limit, period: best.period } : null;
}
