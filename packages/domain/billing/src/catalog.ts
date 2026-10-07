/**
 * The plan / product model (Phase 9 Unit 4, docs/DECISIONS.md D-100). A plan is DATA: which exams it opens, which features it
 * unlocks, the usage limits on the metered ones, how long one payment buys, and (optionally) its price. Application code asks
 * "does this student's access include feature F for exam E" and never asks "is this plan X" - there is no `if (plan === ...)`.
 *
 * Nothing here is a business decision. The repository ships NO plan, NO price and NO baseline: the catalog is supplied by
 * configuration (`parsePlanCatalog`) and a deployment that has not configured one has no purchasable plan. Any value used in
 * tests or examples is labelled provisional test data.
 *
 * The package is pure: no database, no HTTP, no environment, no payment-provider SDK.
 */

/** Student features that entitlements can unlock. Question generation is deliberately NOT here: it is a staff operation, never sold to a student. */
export const FEATURE_IDS = ["tutor", "simulation", "advanced_training"] as const;
export type FeatureId = (typeof FEATURE_IDS)[number];

/** Metered operations. Each belongs to exactly one feature (`METER_FEATURE`); a feature with a meter must declare a limit for it. */
export const METER_IDS = ["tutor_request", "simulation_start"] as const;
export type MeterId = (typeof METER_IDS)[number];

export const METER_FEATURE: Readonly<Record<MeterId, FeatureId>> = Object.freeze({ tutor_request: "tutor", simulation_start: "simulation" });

export const USAGE_PERIODS = ["day", "month"] as const;
export type UsagePeriod = (typeof USAGE_PERIODS)[number];

export interface UsageLimit {
  meter: MeterId;
  /** A non-negative whole number of units per period, or `"unlimited"`. Zero is a valid limit (the feature is listed but allows nothing). */
  limit: number | "unlimited";
  /** Calendar period in UTC. */
  period: UsagePeriod;
}

export interface PlanPrice {
  /** Minor currency units (e.g. paise, cents). The SERVER sends this to the provider; a client never supplies it. */
  amountMinor: number;
  /** ISO 4217 code, upper case. */
  currency: string;
  /** The provider's own price/plan identifier, when the provider has one. Opaque to this package. */
  providerPriceRef: string | null;
}

export interface PlanDefinition {
  id: string;
  name: string;
  description: string;
  /** Inactive plans cannot be purchased; existing subscriptions to them keep their access until they end. */
  active: boolean;
  /** True while the plan's content (limits, duration, price) has not been decided as final business policy. Shown to the owner, never hidden. */
  provisional: boolean;
  exams: string[];
  features: FeatureId[];
  usageLimits: UsageLimit[];
  /** How long ONE successful payment extends access. */
  durationDays: number;
  /** `null` = not purchasable (no price configured). */
  price: PlanPrice | null;
}

/** What every authenticated, enrolled student has without any subscription. Empty unless configured: a deployment decides what is free. */
export interface AccessBaseline {
  exams: string[];
  features: FeatureId[];
  usageLimits: UsageLimit[];
}

export interface PlanCatalog {
  baseline: AccessBaseline;
  plans: PlanDefinition[];
}

export class CatalogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CatalogError";
  }
}

export const EMPTY_BASELINE: AccessBaseline = Object.freeze({ exams: [], features: [], usageLimits: [] }) as AccessBaseline;

const ID = /^[a-z][a-z0-9_]{0,39}$/;
const EXAM_CODE = /^[A-Z][A-Z0-9_]{1,39}$/;
const CURRENCY = /^[A-Z]{3}$/;
const PRICE_REF = /^[A-Za-z0-9_.:-]{1,100}$/;
const MAX_DURATION_DAYS = 3660;
const MAX_LIMIT = 1_000_000;
/** Largest amount (minor units) the persistence layer stores: a 32-bit signed integer, comfortably above any plausible price. */
export const MAX_AMOUNT_MINOR = 2_000_000_000;

const fail = (message: string): never => {
  throw new CatalogError(message);
};
const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
function onlyKeys(value: Record<string, unknown>, allowed: readonly string[], where: string): void {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(`${where}: unexpected field "${key.slice(0, 40)}"`);
}
function stringList<T extends string>(value: unknown, allowed: readonly T[] | RegExp, where: string): T[] {
  if (!Array.isArray(value)) return fail(`${where} must be a list`);
  const out: T[] = [];
  for (const item of value) {
    const ok = typeof item === "string" && (allowed instanceof RegExp ? allowed.test(item) : (allowed as readonly string[]).includes(item));
    if (!ok) fail(`${where} has an invalid entry`);
    if (out.includes(item as T)) fail(`${where} has a duplicate entry`);
    out.push(item as T);
  }
  return out;
}

function parseLimits(value: unknown, features: readonly FeatureId[], where: string): UsageLimit[] {
  if (!Array.isArray(value)) return fail(`${where}.usageLimits must be a list`);
  const limits: UsageLimit[] = [];
  for (const raw of value) {
    if (!isRecord(raw)) return fail(`${where}.usageLimits entries must be objects`);
    onlyKeys(raw, ["meter", "limit", "period"], `${where}.usageLimits`);
    const meter = raw.meter;
    if (typeof meter !== "string" || !(METER_IDS as readonly string[]).includes(meter)) return fail(`${where}.usageLimits has an unknown meter`);
    const m = meter as MeterId;
    if (limits.some((l) => l.meter === m)) fail(`${where}.usageLimits repeats a meter`);
    if (!features.includes(METER_FEATURE[m])) fail(`${where}.usageLimits limits a meter whose feature is not included`);
    const limit = raw.limit;
    if (limit !== "unlimited" && !(typeof limit === "number" && Number.isInteger(limit) && limit >= 0 && limit <= MAX_LIMIT)) return fail(`${where}.usageLimits.limit must be a whole number from 0 to ${MAX_LIMIT} or "unlimited"`);
    const period = raw.period;
    if (typeof period !== "string" || !(USAGE_PERIODS as readonly string[]).includes(period)) return fail(`${where}.usageLimits.period must be day or month`);
    limits.push({ meter: m, limit: limit as number | "unlimited", period: period as UsagePeriod });
  }
  for (const feature of features) {
    for (const meter of METER_IDS) if (METER_FEATURE[meter] === feature && !limits.some((l) => l.meter === meter)) fail(`${where}: feature "${feature}" is metered and needs an explicit limit for "${meter}"`);
  }
  return limits;
}

function parseBaseline(value: unknown): AccessBaseline {
  if (value === undefined) return { exams: [], features: [], usageLimits: [] };
  if (!isRecord(value)) return fail("baseline must be an object");
  onlyKeys(value, ["exams", "features", "usageLimits"], "baseline");
  const exams = stringList(value.exams ?? [], EXAM_CODE, "baseline.exams");
  const features = stringList<FeatureId>(value.features ?? [], FEATURE_IDS, "baseline.features");
  return { exams, features, usageLimits: parseLimits(value.usageLimits ?? [], features, "baseline") };
}

function parsePlan(raw: unknown): PlanDefinition {
  if (!isRecord(raw)) return fail("each plan must be an object");
  onlyKeys(raw, ["id", "name", "description", "active", "provisional", "exams", "features", "usageLimits", "durationDays", "price"], "plan");
  const id = raw.id;
  if (typeof id !== "string" || !ID.test(id)) return fail("plan.id must be lower_snake_case, up to 40 characters");
  const where = `plan "${id}"`;
  if (typeof raw.name !== "string" || raw.name.trim() === "" || raw.name.length > 80) fail(`${where}: name is required (up to 80 characters)`);
  if (typeof raw.description !== "string" || raw.description.length > 400) fail(`${where}: description must be a string (up to 400 characters)`);
  if (typeof raw.active !== "boolean") fail(`${where}: active must be true or false`);
  if (typeof raw.provisional !== "boolean") fail(`${where}: provisional must be true or false (say whether this plan is final business policy)`);
  const exams = stringList(raw.exams, EXAM_CODE, `${where}.exams`);
  if (exams.length === 0) fail(`${where}: a plan must open at least one exam`);
  const features = stringList<FeatureId>(raw.features, FEATURE_IDS, `${where}.features`);
  const durationDays = raw.durationDays;
  if (typeof durationDays !== "number" || !Number.isInteger(durationDays) || durationDays < 1 || durationDays > MAX_DURATION_DAYS) fail(`${where}: durationDays must be a whole number from 1 to ${MAX_DURATION_DAYS}`);
  let price: PlanPrice | null = null;
  if (raw.price !== null && raw.price !== undefined) {
    if (!isRecord(raw.price)) return fail(`${where}: price must be an object or null`);
    onlyKeys(raw.price, ["amountMinor", "currency", "providerPriceRef"], `${where}.price`);
    const { amountMinor, currency, providerPriceRef } = raw.price;
    if (typeof amountMinor !== "number" || !Number.isInteger(amountMinor) || amountMinor <= 0 || amountMinor > MAX_AMOUNT_MINOR) fail(`${where}: price.amountMinor must be a positive whole number of minor units`);
    if (typeof currency !== "string" || !CURRENCY.test(currency)) fail(`${where}: price.currency must be a 3-letter upper-case ISO code`);
    if (providerPriceRef !== null && providerPriceRef !== undefined && (typeof providerPriceRef !== "string" || !PRICE_REF.test(providerPriceRef))) fail(`${where}: price.providerPriceRef is malformed`);
    price = { amountMinor: amountMinor as number, currency: currency as string, providerPriceRef: (providerPriceRef as string | null | undefined) ?? null };
  }
  return {
    id,
    name: (raw.name as string).trim(),
    description: raw.description as string,
    active: raw.active as boolean,
    provisional: raw.provisional as boolean,
    exams,
    features,
    usageLimits: parseLimits(raw.usageLimits, features, where),
    durationDays: durationDays as number,
    price
  };
}

/**
 * Validates an untrusted catalog (from configuration) and returns a frozen, normalized copy. Throws `CatalogError` - a catalog
 * that is wrong is a startup failure, never silently "mostly applied". Unknown fields are refused, so a typo such as `featurs`
 * cannot quietly produce a plan that grants less (or, via a different typo, more) than intended.
 */
export function parsePlanCatalog(input: unknown): PlanCatalog {
  if (!isRecord(input)) return fail("the catalog must be an object");
  onlyKeys(input, ["baseline", "plans"], "catalog");
  if (!Array.isArray(input.plans)) return fail("catalog.plans must be a list");
  const plans = input.plans.map(parsePlan);
  const seen = new Set<string>();
  for (const plan of plans) {
    if (seen.has(plan.id)) fail(`duplicate plan id "${plan.id}"`);
    seen.add(plan.id);
  }
  return Object.freeze({ baseline: parseBaseline(input.baseline), plans }) as PlanCatalog;
}

/** Parses the JSON text of a catalog (an environment variable or a file's contents). */
export function parsePlanCatalogJson(text: string): PlanCatalog {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return fail("the catalog is not valid JSON");
  }
  return parsePlanCatalog(value);
}

export function findPlan(catalog: PlanCatalog, planId: string): PlanDefinition | null {
  return catalog.plans.find((p) => p.id === planId) ?? null;
}

/** A plan the server will start a checkout for: active AND priced. The client may only NAME a plan; this is the allowlist it is checked against. */
export function findPurchasablePlan(catalog: PlanCatalog, planId: unknown): (PlanDefinition & { price: PlanPrice }) | null {
  if (typeof planId !== "string") return null;
  const plan = findPlan(catalog, planId);
  return plan && plan.active && plan.price !== null ? (plan as PlanDefinition & { price: PlanPrice }) : null;
}
