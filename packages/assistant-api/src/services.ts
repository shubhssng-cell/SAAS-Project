import type { AiProvider } from "@ipmat/ai";
import { createOrchestrator, generationCapability, personalizationCapability, tutorCapability, type CapabilityHandler, type CapabilityId, type OrchestrationAuditSink, type Orchestrator } from "@ipmat/ai-orchestration";
import { randomUUID } from "node:crypto";
import { currentContext, type Logger, type Metrics } from "@ipmat/observability";
import type { PreferenceStore } from "@ipmat/personalization";
import type { QuestionGenerationService } from "@ipmat/question-generation";
import type { SimulationService } from "@ipmat/exam-simulation";
import { createTutorService, type TutorAuditSink, type TutorContextDeps } from "@ipmat/tutor";
import { ContentGenerationApiService } from "./generation.js";
import { PreferencesApiService } from "./preferences.js";
import { SimulationApiService } from "./simulation.js";
import { TutorApiService } from "./tutor.js";

/**
 * Composition of the application services (Phase 9 Unit 2, D-098) over the EXISTING domain services - no policy lives here.
 *
 * The orchestrator is the Phase 8 one, unchanged: a closed registry, fixed workflows, authorization first. This function only
 * decides which capability IMPLEMENTATIONS exist in this deployment, from what the caller injected:
 *   - `tutor_response` exists only when a model provider was injected (no provider => the tutor is honestly unavailable);
 *   - `personalization` always exists (deterministic, model-free, reads only the student's explicit preferences);
 *   - `question_generation` exists only when a generation service was injected (staff path; no HTTP route);
 *   - the Phase 7 reader capabilities (revision, curriculum, simulation intelligence, exam intelligence) are NOT bound: none has a
 *     defined student-facing presentation (D-088/D-089/D-091, D-096), so no application path reads them. They stay internal.
 * A capability that is not bound is an explicit `capability_unavailable`, never a substitution.
 */
export interface AssistantDependencies {
  ownership: TutorContextDeps["ownership"];
  tutorPorts: Omit<TutorContextDeps, "ownership">;
  /** Any `@ipmat/ai` provider. `null` = none configured (the tutor then reports `not_available`). Keys live inside the provider, never here. */
  provider: AiProvider | null;
  preferences: PreferenceStore;
  audit?: OrchestrationAuditSink;
  tutorAudit?: TutorAuditSink;
  simulation?: SimulationService | null;
  generation?: QuestionGenerationService | null;
  listOtherExamTerms?: (examCode: string) => Promise<readonly string[]> | readonly string[];
  now?: () => Date;
  /** Defaults to the current HTTP request's correlation id (so the orchestration audit and the logs share it), else a fresh one. */
  newRequestId?: () => string;
  /** Bounds for one provider call (timeout and explicit retry count), applied to the tutor. */
  aiOptions?: { timeoutMs?: number; maxRetries?: number };
  /** Overall wall-clock bound for one tutor request. */
  tutorDeadlineMs?: number;
  metrics?: Metrics;
  logger?: Logger;
}

export interface AssistantServices {
  tutor: TutorApiService;
  preferences: PreferencesApiService;
  simulation: SimulationApiService | null;
  /** Staff-only; no HTTP route is bound to it. */
  generation: ContentGenerationApiService | null;
}

export function createAssistantServices(deps: AssistantDependencies): AssistantServices {
  const requestId = deps.newRequestId ?? ((): string => currentContext()?.requestId ?? randomUUID());
  const handlers: Partial<Record<CapabilityId, CapabilityHandler>> = {
    personalization: personalizationCapability({ ownership: deps.ownership, store: deps.preferences })
  };
  if (deps.provider) {
    const tutor = createTutorService({
      ...deps.tutorPorts,
      ownership: deps.ownership,
      provider: deps.provider,
      listOtherExamTerms: deps.listOtherExamTerms,
      audit: deps.tutorAudit,
      now: deps.now,
      newRequestId: requestId,
      aiOptions: deps.aiOptions
    });
    handlers.tutor_response = tutorCapability(tutor);
  }
  if (deps.generation) handlers.question_generation = generationCapability(deps.generation);

  const orchestrator: Orchestrator = createOrchestrator({ ownership: deps.ownership, handlers, audit: deps.audit, now: deps.now, newRequestId: requestId });
  return {
    tutor: new TutorApiService({ orchestrator, tutorAvailable: deps.provider !== null, deadlineMs: deps.tutorDeadlineMs, metrics: deps.metrics, logger: deps.logger }),
    preferences: new PreferencesApiService(deps.preferences),
    simulation: deps.simulation ? new SimulationApiService(deps.simulation) : null,
    generation: deps.generation ? new ContentGenerationApiService(orchestrator) : null
  };
}
