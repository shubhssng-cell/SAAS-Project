import { randomUUID } from "node:crypto";
import type { EntitlementService, FeatureId, MeterId, UsageReservation, UsageService } from "@ipmat/billing";
import { currentContext, NOOP_LOGGER, NOOP_METRICS, type Logger, type Metrics } from "@ipmat/observability";
import { BillingApiError, infrastructureError, type BillingClaim, type ExamScopeResolver } from "./errors.js";

/**
 * The ONE place a feature request meets the commercial rules (Phase 9 Unit 4, D-100). Routes do not read billing state: they ask
 * this guard, which asks the entitlement service and the usage service, and either lets the existing application service run
 * unchanged or refuses with a fixed student-safe error. The guard knows nothing about tutoring, simulation or training logic -
 * commercial rules never reach into the intelligence engines.
 *
 * Authentication and enrollment are checked BEFORE this (the claim is the verified session student and their own enrollment);
 * entitlement is a further, separate requirement. A refusal here changes no billing state.
 */
export interface CommerceGuardDependencies {
  entitlements: EntitlementService;
  usage: UsageService;
  examScope: ExamScopeResolver;
  metrics?: Metrics;
  logger?: Logger;
}

const MESSAGES = {
  exam: "Your current access doesn't include this exam.",
  feature: "Your current access doesn't include this feature.",
  usage: "You've reached your limit for this feature for now."
} as const;

type DenyReason = "not_entitled_exam" | "not_entitled_feature" | "usage_limit_reached" | "no_limit_defined";

export class CommerceGuard {
  private readonly metrics: Metrics;
  private readonly logger: Logger;

  constructor(private readonly deps: CommerceGuardDependencies) {
    this.metrics = deps.metrics ?? NOOP_METRICS;
    this.logger = deps.logger ?? NOOP_LOGGER;
  }

  get enforced(): boolean {
    return this.deps.entitlements.mode === "enforced";
  }

  private async examOf(claim: BillingClaim): Promise<string> {
    const examCode = await this.deps.examScope(claim.studentId, claim.enrollmentId);
    // An enrollment that does not resolve to this student can never be entitled.
    if (examCode === null) return this.deny("not_entitled_exam", null);
    return examCode;
  }

  private deny(reason: DenyReason, feature: FeatureId | null): never {
    this.metrics.inc("billing_denied_total", { category: reason, ...(feature ? { feature } : {}) });
    this.logger.info("billing.access_denied", { failureCategory: reason, ...(feature ? { feature } : {}) });
    if (reason === "usage_limit_reached") throw new BillingApiError("usage_limit_reached", MESSAGES.usage, 403);
    throw new BillingApiError("not_entitled", reason === "not_entitled_exam" ? MESSAGES.exam : MESSAGES.feature, 403);
  }

  /** Core exam access for the student's enrolled exam. A no-op in `open` mode. */
  async requireExam(claim: BillingClaim): Promise<void> {
    if (!this.enforced) return;
    try {
      const examCode = await this.examOf(claim);
      const decision = await this.deps.entitlements.canAccessExam(claim.studentId, examCode);
      if (!decision.allowed) this.deny("not_entitled_exam", null);
    } catch (error) {
      throw this.rethrow(error);
    }
  }

  /** A feature without metering. A no-op in `open` mode. */
  async requireFeature(claim: BillingClaim, feature: FeatureId): Promise<void> {
    if (!this.enforced) return;
    try {
      const examCode = await this.examOf(claim);
      const decision = await this.deps.entitlements.decide(claim.studentId, feature, examCode);
      if (!decision.allowed) this.deny(decision.reason === "not_entitled_exam" ? "not_entitled_exam" : "not_entitled_feature", feature);
    } catch (error) {
      throw this.rethrow(error);
    }
  }

  /**
   * Runs `work` under a feature entitlement AND a usage reservation. The unit is reserved BEFORE `work` (so concurrent requests
   * cannot all pass a check only one should), then settled by the caller's rule: `consumed` when the work delivered value,
   * `released` when it did not (or threw). Settling never changes the response.
   */
  async metered<T>(claim: BillingClaim, feature: FeatureId, meter: MeterId, work: () => Promise<T>, settle: (result: T) => "consumed" | "released"): Promise<T> {
    if (!this.enforced) return work();
    let reservation: UsageReservation | null = null;
    try {
      const examCode = await this.examOf(claim);
      const decision = await this.deps.entitlements.decide(claim.studentId, feature, examCode);
      if (!decision.allowed) this.deny(decision.reason === "not_entitled_exam" ? "not_entitled_exam" : "not_entitled_feature", feature);
      const requestId = currentContext()?.requestId ?? randomUUID();
      const usage = await this.deps.usage.reserve(claim.studentId, examCode, meter, requestId);
      if (!usage.allowed) this.deny(usage.reason, feature);
      reservation = usage.allowed ? usage.reservation : null;
    } catch (error) {
      throw this.rethrow(error);
    }
    let outcome: "consumed" | "released" = "released";
    try {
      const result = await work();
      outcome = settle(result);
      return result;
    } finally {
      try {
        await this.deps.usage.settle(claim.studentId, reservation, outcome);
        this.metrics.inc("billing_usage_total", { meter, outcome });
      } catch {
        // A unit that stays `reserved` still counts toward the limit (the conservative side); never fail the student's response for it.
        this.logger.error("billing.usage_settle_failed", { meter, failureCategory: "dependency_unavailable" });
      }
    }
  }

  private rethrow(error: unknown): Error {
    if (error instanceof BillingApiError) return error;
    this.logger.error("billing.guard_failed", { errorName: error instanceof Error ? error.name : "unknown", failureCategory: "dependency_unavailable" });
    return infrastructureError(error, "Something went wrong. Please try again.");
  }
}
