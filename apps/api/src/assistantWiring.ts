import { randomUUID } from "node:crypto";
import { AnthropicProvider, type AiProvider } from "@ipmat/ai";
import { createAssistantServices, ExamPackTutorConceptPort, type AssistantServices } from "@ipmat/assistant-api";
import {
  InMemoryOrchestrationAuditStore,
  PrismaExamPackRepository,
  PrismaOrchestrationAuditStore,
  PrismaPreferenceStore,
  PrismaSimulationEnrollmentReader,
  PrismaSimulationQuestionSource,
  PrismaSimulationRepository,
  PrismaTutorAttemptPort,
  PrismaTutorOwnershipPort,
  PrismaTutorQuestionPort
} from "@ipmat/db";
import type { AiUsageSink } from "@ipmat/billing";
import { SimulationService } from "@ipmat/exam-simulation";
import { InMemoryPreferenceStore } from "@ipmat/personalization";
import type { PrismaClient } from "@prisma/client";
import { resolveAiConfig } from "./hypothesisWiring.js";
import { observeProvider } from "./providerObservability.js";
import type { ApiRuntime } from "./hardening.js";

/** Explicit, bounded provider budget for the tutor: one retry, a 20 s per-call timeout, and a 45 s overall request deadline (Phase 9 Unit 3, D-099). */
export const TUTOR_AI_OPTIONS = { timeoutMs: 20_000, maxRetries: 1 } as const;

/**
 * Phase 9 Unit 2 (D-098) -- the ONE place the tutor / preferences / simulation application services meet concrete
 * implementations. It reads the SAME `IPMAT_AI_PROVIDER` / `ANTHROPIC_API_KEY` / `IPMAT_AI_MODEL` configuration as the hypothesis
 * generator (`resolveAiConfig`, explicit and fail-closed) and hands the provider to the existing `@ipmat/ai` abstraction: no key
 * is read, held or logged here (the Anthropic SDK reads the environment itself), and no provider SDK is imported by any domain
 * package.
 *
 *   - `anthropic`     -> the real provider; the tutor is available.
 *   - `none`          -> no provider; the tutor answers `not_available`. It is never faked.
 *   - `dev-scripted`  -> that scaffold imitates the HYPOTHESIS task only and is not a tutor model, so the tutor stays unavailable.
 *
 * Simulation: the repository supplies NO exam configuration (no authoritative IPMAT duration/sections/counts - D-090), so the
 * config source is empty and a start request answers `no_simulation_configured` until the owner supplies one.
 * Question generation and the Phase 7 intelligence readers are NOT bound (see D-098).
 */
/** The production simulation configuration source: EMPTY. No authoritative IPMAT duration/sections/counts exist in the repository (D-090), so every start answers `no_simulation_configured` and availability is `false` until the owner supplies one. */
const SIMULATION_CONFIGS = { findDefinition: async (_examCode: string): Promise<null> => null };

export function resolveTutorProvider(env: Record<string, string | undefined>): AiProvider | null {
  const config = resolveAiConfig(env);
  return config.kind === "anthropic" ? new AnthropicProvider(config.model) : null;
}

export function createPrismaAssistantServices(prisma: PrismaClient, env: Record<string, string | undefined>, runtime?: Pick<ApiRuntime, "logger" | "metrics">, usage?: AiUsageSink): AssistantServices {
  const raw = resolveTutorProvider(env);
  return createAssistantServices({
    ownership: new PrismaTutorOwnershipPort(prisma),
    tutorPorts: { questions: new PrismaTutorQuestionPort(prisma), concepts: new ExamPackTutorConceptPort(new PrismaExamPackRepository(prisma)), attempts: new PrismaTutorAttemptPort(prisma) },
    provider: raw ? observeProvider(raw, { ...runtime, usage }) : null,
    aiOptions: TUTOR_AI_OPTIONS,
    metrics: runtime?.metrics,
    logger: runtime?.logger,
    preferences: new PrismaPreferenceStore(prisma),
    audit: new PrismaOrchestrationAuditStore(prisma),
    simulationConfigured: async (examCode) => (await SIMULATION_CONFIGS.findDefinition(examCode)) !== null,
    simulation: new SimulationService({
      enrollments: new PrismaSimulationEnrollmentReader(prisma),
      configs: SIMULATION_CONFIGS,
      questions: new PrismaSimulationQuestionSource(prisma),
      repository: new PrismaSimulationRepository(prisma),
      now: () => new Date().toISOString(),
      newId: randomUUID
    })
  });
}

/**
 * The in-memory (development) wiring: preferences work; the tutor and simulations are not available (the in-memory world has no
 * answer-bearing question reader or simulation store), and ownership FAILS CLOSED rather than guessing.
 */
export function createInMemoryAssistantServices(): AssistantServices {
  return createAssistantServices({
    ownership: { resolveEnrollment: async () => null },
    tutorPorts: {
      questions: { getQuestion: async () => null },
      concepts: { getConceptGraph: async () => ({ concepts: [], relations: [] }) },
      attempts: { getLatestAttempt: async () => null }
    },
    provider: null,
    preferences: new InMemoryPreferenceStore(),
    audit: new InMemoryOrchestrationAuditStore()
  });
}
