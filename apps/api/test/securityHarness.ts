import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { createAssistantServices, type AssistantServices } from "@ipmat/assistant-api";
import { InMemoryOrchestrationAuditStore } from "@ipmat/db";
import { InMemorySimulationRepository, SimulationService } from "@ipmat/exam-simulation";
import { createLogger, createMetrics, createRateLimiter, type Metrics } from "@ipmat/observability";
import { InMemoryPreferenceStore } from "@ipmat/personalization";
import type { EntitlementMode, PlanCatalog } from "@ipmat/billing";
import type { CommerceServices } from "@ipmat/billing-api";
import { HmacTestProvider, testCatalog } from "@ipmat/billing-api/testing";
import type { InMemoryBillingStore } from "@ipmat/db";
import { createInMemoryCommerce } from "../src/commerceWiring.js";
import { createRuntime, DEFAULT_RATE_RULES, type ApiRuntime, type RateBucket } from "../src/hardening.js";
import { observeProvider } from "../src/providerObservability.js";
import { createServer } from "../src/server.js";
import { createInMemoryDependencies } from "../src/wiring.js";
import { attemptPort, conceptsPort, EXAM, ownershipPort, questionPort, ScriptedProvider, simulationDefinition, simulationSource, tutorQuestion } from "./assistantFixtures.js";
import { trainingTestSeed } from "./trainingSeed.js";

/**
 * Shared harness for the Phase 9 Unit 3 security/abuse suites: the real HTTP server on the in-memory wiring, the REAL application
 * services, orchestrator, grounding validator, rate limiter, logger and metrics. Only the model is a deterministic double. Every
 * identifier and credential here is synthetic.
 */
export const Q = "h-std-1";
export const OTHER_EXAM_Q = "other-exam-q";

export interface AppOptions {
  rules?: Partial<Record<RateBucket, { limit: number; windowMs: number }>>;
  /** `true` (default): rate limiting on with generous defaults. `false`: off. */
  limiter?: boolean;
  allowedOrigins?: string[] | null;
  tutorDeadlineMs?: number;
  readiness?: () => Promise<boolean>;
  production?: boolean;
  trustProxy?: boolean;
  maxBodyBytes?: number;
  extraQuestions?: ReturnType<typeof tutorQuestion>[];
  clock?: () => number;
  /** Phase 9 Unit 4: wire the commercial layer. Omitted = the pre-Unit-4 behaviour (no commerce at all). */
  commerce?: { mode: EntitlementMode; catalog?: PlanCatalog; provider?: boolean; now?: () => Date };
}

export interface App {
  base: string;
  deps: ReturnType<typeof createInMemoryDependencies>;
  provider: ScriptedProvider;
  audits: InMemoryOrchestrationAuditStore;
  preferences: InMemoryPreferenceStore;
  assistant: AssistantServices;
  metrics: Metrics;
  logs: string[];
  logRecords: () => Array<Record<string, unknown>>;
  known: Set<string>;
  call: (method: string, path: string, body?: unknown, cookie?: string, headers?: Record<string, string>, rawBody?: string) => Promise<{ status: number; json: Record<string, unknown>; raw: string; headers: Headers }>;
  /** Present only when `options.commerce` was given. */
  commerce: CommerceServices | null;
  billing: InMemoryBillingStore | null;
  payments: HmacTestProvider;
  student: (enroll?: boolean) => Promise<{ cookie: string; studentId: string; email: string }>;
  submit: (cookie: string, questionId: string, chosenAnswer: string) => Promise<string>;
  close: () => Promise<void>;
}

let counter = 0;

export async function buildApp(options: AppOptions = {}): Promise<App> {
  const deps = createInMemoryDependencies(trainingTestSeed());
  const provider = new ScriptedProvider();
  const known = new Set<string>();
  const audits = new InMemoryOrchestrationAuditStore(known);
  const preferences = new InMemoryPreferenceStore();
  const logs: string[] = [];
  const logger = createLogger({ sink: (l) => logs.push(l) });
  const metrics = createMetrics();
  const clock = { t: 1_000_000 };
  const ownership = ownershipPort(async (id) => deps.enrollmentReader.findById(id));
  const sim = new SimulationService({
    enrollments: { findById: async (id) => { const e = await deps.enrollmentReader.findById(id); return e ? { id: e.id, studentId: e.studentId, examCode: EXAM } : null; } },
    configs: { findDefinition: async (code) => (code === EXAM ? simulationDefinition : null) },
    questions: simulationSource(),
    repository: new InMemorySimulationRepository(),
    now: () => new Date(Date.parse("2026-10-07T10:00:00.000Z")).toISOString(),
    newId: () => randomUUID()
  });
  const assistant = createAssistantServices({
    ownership,
    tutorPorts: { questions: questionPort([Q, "h-std-2", "h-std-3"], [tutorQuestion(OTHER_EXAM_Q, { examCode: "OTHER_EXAM" }), ...(options.extraQuestions ?? [])]), concepts: conceptsPort, attempts: attemptPort(deps.attempts) },
    provider: observeProvider(provider, { metrics, logger }),
    preferences,
    audit: audits,
    simulation: sim,
    aiOptions: { timeoutMs: 20_000, maxRetries: 0 },
    tutorDeadlineMs: options.tutorDeadlineMs,
    metrics,
    logger
  });
  const rules = { ...DEFAULT_RATE_RULES, ...(options.rules ?? {}) };
  const runtime: ApiRuntime = createRuntime({
    logger,
    metrics,
    limiter: options.limiter === false ? null : createRateLimiter({ now: options.clock ?? (() => clock.t) }),
    rules,
    readiness: options.readiness ?? (async () => true),
    security: { allowedOrigins: options.allowedOrigins ?? null, trustProxy: options.trustProxy ?? false, production: options.production ?? false, maxBodyBytes: options.maxBodyBytes ?? 32 * 1024 }
  });
  const payments = new HmacTestProvider();
  const built = options.commerce
    ? createInMemoryCommerce({ mode: options.commerce.mode, catalog: options.commerce.catalog ?? testCatalog(), returnUrl: null, provider: options.commerce.provider === false ? null : payments }, deps, { logger, metrics }, known, options.commerce.now)
    : null;
  const server = createServer({ ...deps, assistant, commerce: built?.commerce ?? null, runtime });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const call: App["call"] = async (method, path, body, cookie, headers = {}, rawBody) => {
    const h: Record<string, string> = { ...headers };
    if ((body !== undefined || rawBody !== undefined) && h["content-type"] === undefined) h["content-type"] = "application/json";
    if (cookie) h.cookie = cookie;
    const res = await fetch(`${base}${path}`, { method, headers: h, body: rawBody ?? (body !== undefined ? JSON.stringify(body) : undefined) });
    const raw = await res.text();
    let json: Record<string, unknown> = {};
    try {
      json = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      /* not json */
    }
    return { status: res.status, json, raw, headers: res.headers };
  };

  const student: App["student"] = async (enroll = true) => {
    counter += 1;
    const email = `sec-${counter}-${randomUUID().slice(0, 6)}@example.com`;
    const res = await fetch(`${base}/v1/auth/signup`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: "correct-horse-battery-1" }) });
    const cookie = (res.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
    const studentId = ((await res.json()) as { student: { id: string } }).student.id;
    known.add(studentId);
    await fetch(`${base}/v1/onboarding/complete`, { method: "POST", headers: { cookie } });
    if (enroll) await fetch(`${base}/v1/enrollment`, { method: "POST", headers: { cookie } });
    return { cookie, studentId, email };
  };

  const submit: App["submit"] = async (cookie, questionId, chosenAnswer) => {
    const started = await call("POST", "/v1/attempts", { questionId }, cookie);
    const attemptId = started.json.attemptId as string;
    await call("POST", `/v1/attempts/${attemptId}/submit`, { questionId, chosenAnswer }, cookie);
    return attemptId;
  };

  return {
    base,
    deps,
    provider,
    audits,
    preferences,
    assistant,
    commerce: built?.commerce ?? null,
    billing: built?.store ?? null,
    payments,
    metrics,
    logs,
    logRecords: () => logs.map((l) => JSON.parse(l) as Record<string, unknown>),
    known,
    call,
    student,
    submit,
    close: () => new Promise<void>((resolve) => { server.close(() => resolve()); server.closeAllConnections?.(); })
  };
}

/** Advances the harness clock used by the limiter (only for apps built with the default clock). */
export const secretSentinels = { PASSWORD: "correct-horse-battery-1" };
