import { InMemoryPreferenceStore } from "@ipmat/personalization";
import { createOrchestrator, generationCapability, personalizationCapability, readerCapability, tutorCapability, type Actor, type CapabilityHandler, type CapabilityId, type OrchestrationAudit, type OrchestrationRequest, type WorkflowDefinition } from "../src/index.js";
import { EXAM as GEN_EXAM, GOOD, makeEnv as makeGenEnv, makeSpec } from "./genFixtures.js";
import { ENROLL_A, STUDENT_A, tutor, tutorPorts, type Behaviour } from "./tutorFixtures.js";

/** LABELLED TEST FIXTURES. Every model is a deterministic double; no live model, key or network is involved. */
export const STUDENT: Actor = { kind: "student", studentId: STUDENT_A, enrollmentId: ENROLL_A };
export const STAFF: Actor = { kind: "staff", role: "content_admin", examCodes: [GEN_EXAM] };
export const REVIEWER: Actor = { kind: "staff", role: "content_reviewer", examCodes: [GEN_EXAM] };

/** The internal markers the stub readers return: they must never reach a public view. */
export const INTERNAL = { curriculum: "INTERNAL-CURRICULUM-TRACE-q-secret-1", revision: "INTERNAL-REVISION-SIGNAL-q-secret-2", simulation: "INTERNAL-SIMULATION-EVIDENCE-sim-secret-3", exam: "INTERNAL-EXAM-AVAILABILITY" };

export interface OrchOptions {
  tutorScript?: Behaviour[];
  /** Attempts the tutor can see (default: the student has one submitted, incorrect attempt). */
  attempts?: Parameters<typeof tutorPorts>[0];
  genScript?: Behaviour[];
  omit?: CapabilityId[];
  readers?: Partial<Record<"adaptive_curriculum" | "revision_intelligence" | "simulation_intelligence" | "exam_intelligence", (input: Record<string, unknown>) => Promise<unknown | null>>>;
  workflows?: readonly WorkflowDefinition[];
  store?: InMemoryPreferenceStore;
  audit?: OrchestrationAudit[];
}

export function makeOrch(opts: OrchOptions = {}) {
  const calls: Array<{ capability: CapabilityId; input: Record<string, unknown> }> = [];
  const spy = (capability: CapabilityId, handler: CapabilityHandler): CapabilityHandler => async (input, ctx) => {
    calls.push({ capability, input: structuredClone(input) });
    return handler(input, ctx);
  };
  const t = tutor(opts.tutorScript ?? [], opts.attempts ? { ...tutorPorts(opts.attempts) } : {});
  const gen = makeGenEnv(opts.genScript ?? []);
  const store = opts.store ?? new InMemoryPreferenceStore();
  const ports = tutorPorts();
  const readers = {
    adaptive_curriculum: async () => ({ kind: "curriculum", trace: INTERNAL.curriculum }),
    revision_intelligence: async () => ({ kind: "revision", trace: INTERNAL.revision, priority: { defined: false } }),
    simulation_intelligence: async () => ({ kind: "simulation", trace: INTERNAL.simulation, readiness: { defined: false } }),
    exam_intelligence: async () => ({ kind: "exam", trace: INTERNAL.exam }),
    ...opts.readers
  };
  const all: Record<CapabilityId, CapabilityHandler> = {
    tutor_response: spy("tutor_response", tutorCapability(t.service)),
    personalization: spy("personalization", personalizationCapability({ ownership: ports.ownership, store })),
    question_generation: spy("question_generation", generationCapability(gen.service)),
    adaptive_curriculum: spy("adaptive_curriculum", readerCapability(readers.adaptive_curriculum)),
    revision_intelligence: spy("revision_intelligence", readerCapability(readers.revision_intelligence)),
    simulation_intelligence: spy("simulation_intelligence", readerCapability(readers.simulation_intelligence)),
    exam_intelligence: spy("exam_intelligence", readerCapability(readers.exam_intelligence))
  };
  for (const id of opts.omit ?? []) delete (all as Partial<typeof all>)[id];
  const audits: OrchestrationAudit[] = opts.audit ?? [];
  const orch = createOrchestrator({ ownership: ports.ownership, handlers: all, workflows: opts.workflows, audit: { record: (e) => void audits.push(e) }, now: () => new Date("2026-10-06T10:00:00.000Z"), newRequestId: () => "orch-test" });
  return { orch, calls, tutorProvider: t.provider, tutorService: t.service, gen, store, audits, handlers: all };
}

export const req = (task: OrchestrationRequest["task"], params: Record<string, unknown> = {}, actor: Actor = STUDENT): OrchestrationRequest => ({ task, actor, params });
export { GOOD, makeSpec, GEN_EXAM };
