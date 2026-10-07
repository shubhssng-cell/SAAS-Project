import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createOrchestrator, generationCapability, type Orchestrator } from "@ipmat/ai-orchestration";
import { InMemoryExamPackRepository, ipmatIndoreExamPack } from "@ipmat/exam-pack";
import { InMemoryPreferenceStore } from "@ipmat/personalization";
import { describe, expect, it } from "vitest";
import { AssistantApiError, ContentGenerationApiService, ExamPackTutorConceptPort, PreferencesApiService, TutorApiService, type StaffClaim } from "../src/index.js";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const EXAM = "IPMAT_INDORE";
const code = async (p: Promise<unknown>): Promise<string> => p.then(() => "no error", (e: unknown) => (e instanceof AssistantApiError ? `${e.code}:${e.httpStatus}` : "other"));

describe("dependency boundary", () => {
  it("declares only domain/AI-abstraction dependencies, never Prisma, @ipmat/db, a provider SDK or a web/HTTP framework", () => {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf-8")) as { dependencies: Record<string, string> };
    expect(Object.keys(pkg.dependencies).sort()).toEqual(["@ipmat/ai", "@ipmat/ai-orchestration", "@ipmat/concept-graph", "@ipmat/exam-pack", "@ipmat/exam-simulation", "@ipmat/personalization", "@ipmat/question-generation", "@ipmat/tutor"]);
  });

  it("no source file imports Prisma, @ipmat/db, a vendor SDK or node:http, and none reads the environment or a key", () => {
    const banned = ["@prisma/client", "@ipmat/db", "@anthropic-ai/sdk", "openai", "@google/generative-ai", "node:http", "http", "react"];
    for (const file of readdirSync(join(root, "src")).filter((f) => f.endsWith(".ts"))) {
      const text = readFileSync(join(root, "src", file), "utf-8");
      const specifiers = [...text.matchAll(/(?:from\s+|import\()["']([^"']+)["']/g)].map((m) => m[1] ?? "");
      for (const b of banned) expect(specifiers.some((s) => s === b || s.startsWith(`${b}/`)), `${file} imports ${b}`).toBe(false);
      expect(text, file).not.toMatch(/process\.env|API_KEY|apiKey/);
    }
  });
});

describe("TutorApiService request validation (nothing reaches the orchestrator unless it is approved)", () => {
  const calls: unknown[] = [];
  const orchestrator = { run: async (r: unknown) => { calls.push(r); throw new Error("must not run"); }, workflowFor: () => undefined } as unknown as Orchestrator;
  const service = new TutorApiService({ orchestrator, tutorAvailable: true });
  const claim = { studentId: "s", enrollmentId: "e" };

  it.each([
    ["not an object", "give_hint"],
    ["unknown operation", { operation: "generate_question", questionId: "q" }],
    ["internal task name that is not an operation", { operation: "get_help_internal", questionId: "q" }],
    ["identity in the body", { operation: "give_hint", questionId: "q", studentId: "x" }],
    ["capability in the body", { operation: "give_hint", questionId: "q", capability: "question_generation" }],
    ["workflow in the body", { operation: "give_hint", questionId: "q", workflow: "w" }],
    ["presentation in the body", { operation: "give_hint", questionId: "q", presentation: { language: "hindi", verbosity: "detailed" } }],
    ["missing question", { operation: "explain_mistake" }],
    ["concept on a question operation", { operation: "give_hint", questionId: "q", conceptName: "Percentages" }],
    ["question on the concept operation", { operation: "explain_concept", conceptName: "Percentages", questionId: "q" }]
  ])("refuses %s with 400 and runs nothing", async (_n, body) => {
    expect(await code(service.ask(claim, body))).toBe("invalid_request:400");
    expect(calls).toHaveLength(0);
  });

  it("answers 503 when no provider is configured, before running anything", async () => {
    expect(await code(new TutorApiService({ orchestrator, tutorAvailable: false }).ask(claim, { operation: "give_hint", questionId: "q" }))).toBe("not_available:503");
    expect(calls).toHaveLength(0);
  });

  it("an authorization denial from the orchestrator is a 403 (never a normal 'not answered' result), and an unavailable capability is a 503", async () => {
    const result = (kind: string) => ({ requestId: "r", task: "give_hint", workflowId: "w", status: "refused", selection: { rule: "", reason: "" }, ordering: "single_step", steps: [], outputs: {}, failure: { kind, code: "c", message: "m" }, fallback: { occurred: false, from: null, to: null }, decidedBy: "", notes: [], audit: {} });
    const denied = new TutorApiService({ orchestrator: { run: async () => result("authorization_denied"), workflowFor: () => undefined } as unknown as Orchestrator, tutorAvailable: true });
    expect(await code(denied.ask(claim, { operation: "give_hint", questionId: "q" }))).toBe("forbidden:403");
    const missing = new TutorApiService({ orchestrator: { run: async () => result("capability_unavailable"), workflowFor: () => undefined } as unknown as Orchestrator, tutorAvailable: true });
    expect(await code(missing.ask(claim, { operation: "give_hint", questionId: "q" }))).toBe("not_available:503");
  });

  it("maps the six tutor intents plus 'help' to FIXED tasks, with the verified identity as the actor", async () => {
    const seen: Array<{ task: string; actor: unknown; params: unknown }> = [];
    const fake = { run: async (r: { task: string; actor: unknown; params: unknown }) => { seen.push(r); return { requestId: "r", task: r.task, workflowId: "w", status: "failed", selection: { rule: "", reason: "" }, ordering: "single_step", steps: [], outputs: {}, failure: { kind: "handler_error", code: "x", message: "m" }, fallback: { occurred: false, from: null, to: null }, decidedBy: "", notes: [], audit: {} }; }, workflowFor: () => undefined } as unknown as Orchestrator;
    const svc = new TutorApiService({ orchestrator: fake, tutorAvailable: true });
    for (const [operation, task] of [["explain_question", "explain_question"], ["give_hint", "give_hint"], ["guide_with_question", "guide_with_question"], ["explain_mistake", "explain_mistake"], ["clarify_solution", "clarify_solution"], ["help", "get_help"]] as const) {
      await svc.ask(claim, { operation, questionId: "q1" });
      expect(seen.at(-1)).toMatchObject({ task, actor: { kind: "student", studentId: "s", enrollmentId: "e" }, params: { questionId: "q1" } });
    }
    await svc.ask(claim, { operation: "explain_concept", conceptName: "Percentages" });
    expect(seen.at(-1)).toMatchObject({ task: "explain_concept", params: { conceptName: "Percentages" } });
    expect(seen.every((r) => Object.keys(r.params as object).every((k) => ["questionId", "conceptName", "focus", "priorInteraction"].includes(k)))).toBe(true);
  });

  it("a failing orchestration never surfaces its failure code or message; a throwing one is a fixed 500", async () => {
    const failing = { run: async () => ({ requestId: "r", task: "give_hint", workflowId: "w", status: "failed", selection: { rule: "", reason: "" }, ordering: "single_step", steps: [{ stepId: "t", capabilityId: "tutor_response", status: "failed", skippedBecause: null, failure: { kind: "grounding_failure", code: "answer_key_leakage", message: "the answer key was mentioned: SECRET-42" }, validation: null, inputDigest: null, startedAt: null, endedAt: null, isFallback: false }], outputs: {}, failure: null, fallback: { occurred: false, from: null, to: null }, decidedBy: "", notes: [], audit: {} }), workflowFor: () => undefined } as unknown as Orchestrator;
    const dto = await new TutorApiService({ orchestrator: failing, tutorAvailable: true }).ask(claim, { operation: "give_hint", questionId: "q" });
    expect(JSON.stringify(dto)).not.toMatch(/answer_key_leakage|SECRET-42|grounding_failure/);
    expect(dto.failure?.code).toBe("could_not_verify");
    const throwing = { run: async () => { throw new Error("boom with /srv/secret/path"); }, workflowFor: () => undefined } as unknown as Orchestrator;
    await expect(new TutorApiService({ orchestrator: throwing, tutorAvailable: true }).ask(claim, { operation: "give_hint", questionId: "q" })).rejects.toMatchObject({ code: "infrastructure_failure", httpStatus: 500, message: "Something went wrong. Please try again." });
  });
});

describe("PreferencesApiService", () => {
  const claim = { studentId: "s1", enrollmentId: "e1" };
  it("validates through the domain, keys storage by the verified student, and never leaks a storage error", async () => {
    const store = new InMemoryPreferenceStore();
    const svc = new PreferencesApiService(store);
    expect((await svc.update(claim, { language: "hindi" })).preferences.language).toBe("hindi");
    expect((await store.get("s1")).language).toBe("hindi");
    expect(await code(svc.update(claim, { studentId: "s2", language: "english" }))).toBe("invalid_request:400");
    expect(await code(svc.update(claim, { confidence: "high" }))).toBe("invalid_request:400");
    expect(await code(svc.update(claim, []))).toBe("invalid_request:400");
    const broken = new PreferencesApiService({ get: async () => { throw new Error("Prisma P2002 secret"); }, set: async () => { throw new Error("Prisma P2002 secret"); } });
    for (const p of [broken.get(claim), broken.update(claim, { language: "hindi" })]) await expect(p).rejects.toMatchObject({ code: "infrastructure_failure", httpStatus: 500 });
    await expect(broken.get(claim)).rejects.not.toThrow(/Prisma|secret/);
  });
});

describe("ContentGenerationApiService (staff only; no route; never publishes)", () => {
  const outcome = { kind: "ai_validated_awaiting_review", trace: { reasons: [], reviewRequired: true, publishable: false } };
  const calls: unknown[] = [];
  const orchestrator = createOrchestrator({
    ownership: { resolveEnrollment: async () => null },
    handlers: { question_generation: generationCapability({ generateOne: async (spec: unknown) => { calls.push(spec); return outcome; } } as never) }
  });
  const service = new ContentGenerationApiService(orchestrator);
  const staff: StaffClaim = { kind: "staff", role: "content_admin", examCodes: [EXAM] };
  const spec = { blueprint: { examCode: EXAM } };

  it("runs the fixed generation task for an authorized staff claim and reports codes only, published: false", async () => {
    const result = await service.generate(staff, { spec });
    expect(result).toEqual({ outcome: "ai_validated_awaiting_review", reasonCodes: [], reviewRequired: true, published: false });
    expect(calls).toHaveLength(1);
  });

  it("refuses a student, a hand-built or escalated claim, and a spec for an exam outside the staff member's exams", async () => {
    const before = calls.length;
    for (const claim of [{ kind: "student", studentId: "s", enrollmentId: "e" }, { kind: "student", role: "content_admin", examCodes: [EXAM] }, { kind: "staff", role: "superuser", examCodes: [EXAM] }, { kind: "staff", role: "content_admin" }, null, undefined, "admin"]) {
      expect(await code(service.generate(claim as never, { spec }))).toBe("forbidden:403");
    }
    expect(await code(service.generate(staff, { spec: { blueprint: { examCode: "OTHER_EXAM" } } }))).toBe("forbidden:403");
    expect(calls.length).toBe(before);
  });

  it("refuses extra body fields (no capability/workflow/publish flag) and a missing spec", async () => {
    for (const body of [{ spec, publish: true }, { spec, capability: "x" }, { spec, workflow: "x" }, { spec: "no" }, {}, null]) {
      expect(await code(service.generate(staff, body))).toBe("invalid_request:400");
    }
  });

  it("has no publish (or approve/review) operation, and its result type cannot say 'published'", () => {
    const names = Object.getOwnPropertyNames(Object.getPrototypeOf(service));
    expect(names.filter((n) => /publish|approve|review|accept/i.test(n))).toEqual([]);
  });
});

describe("ExamPackTutorConceptPort", () => {
  const port = new ExamPackTutorConceptPort(new InMemoryExamPackRepository([ipmatIndoreExamPack]));
  it("builds the concept graph of ONE exam from the pack, drops cross-exam endpoints, and is empty (not guessed) for an unknown exam", async () => {
    const graph = await port.getConceptGraph(EXAM);
    expect(graph.concepts.length).toBeGreaterThan(0);
    const names = new Set(graph.concepts.map((c) => c.name));
    expect(graph.relations.every((r) => names.has(r.from) && names.has(r.to))).toBe(true);
    expect(await port.getConceptGraph("NO_SUCH_EXAM")).toEqual({ concepts: [], relations: [] });
  });
});
