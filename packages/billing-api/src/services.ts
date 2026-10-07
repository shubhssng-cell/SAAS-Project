import { EntitlementService, UsageService, type BillingStore, type EntitlementMode, type PaymentProvider, type PlanCatalog, type UsageStore } from "@ipmat/billing";
import type { Logger, Metrics } from "@ipmat/observability";
import type { ExamScopeResolver } from "./errors.js";
import { CommerceGuard } from "./guard.js";
import { BillingApiService } from "./service.js";
import { BillingWebhookService } from "./webhook.js";

/**
 * Composition of the commercial application services over the billing ports (Phase 9 Unit 4, D-100). No policy lives here: it
 * only wires the entitlement and usage services, the guard that routes consult, the student billing service and the provider
 * webhook over one store, one catalog and one (optional) payment provider.
 */
export interface CommerceDependencies {
  mode: EntitlementMode;
  catalog: PlanCatalog;
  store: BillingStore;
  usageStore: UsageStore;
  /** `null` = no payment provider configured (checkout unavailable, webhook accepts nothing). */
  provider: PaymentProvider | null;
  returnUrl: string | null;
  examScope: ExamScopeResolver;
  now?: () => Date;
  newId: () => string;
  metrics?: Metrics;
  logger?: Logger;
}

export interface CommerceServices {
  billing: BillingApiService;
  webhook: BillingWebhookService;
  guard: CommerceGuard;
  entitlements: EntitlementService;
  examScope: ExamScopeResolver;
}

export function createCommerceServices(deps: CommerceDependencies): CommerceServices {
  const now = deps.now ?? ((): Date => new Date());
  const entitlements = new EntitlementService({ mode: deps.mode, catalog: deps.catalog, subscriptions: deps.store, now });
  const usage = new UsageService({ store: deps.usageStore, entitlements, now, newId: deps.newId });
  return {
    entitlements,
    examScope: deps.examScope,
    guard: new CommerceGuard({ entitlements, usage, examScope: deps.examScope, metrics: deps.metrics, logger: deps.logger }),
    billing: new BillingApiService({ store: deps.store, entitlements, usage, catalog: deps.catalog, provider: deps.provider, returnUrl: deps.returnUrl, now, newId: deps.newId, metrics: deps.metrics, logger: deps.logger }),
    webhook: new BillingWebhookService({ store: deps.store, provider: deps.provider, catalog: deps.catalog, now, metrics: deps.metrics, logger: deps.logger })
  };
}
