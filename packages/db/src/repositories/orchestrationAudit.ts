import { randomUUID } from "node:crypto";
import { CAPABILITY_IDS, FAILURE_KINDS, TASK_IDS, type OrchestrationAudit, type OrchestrationAuditSink } from "@ipmat/ai-orchestration";
import { Prisma, type PrismaClient } from "@prisma/client";
import { PersistenceError } from "./errors.js";

/**
 * DURABLE ORCHESTRATION AUDIT (Phase 9 Unit 1, docs/DECISIONS.md D-097; the audit shape is D-096's `OrchestrationAudit`).
 *
 * What is stored is structured EXECUTION FACTS only: request/correlation id, task, workflow, actor kind, student, exam,
 * outcome, per-step capability/status/digest/failure kind+code, the deciding policy and a timestamp. There is no column
 * for a prompt, response, input, output, parameters, reasoning, plan or scratchpad, and `sanitizeAuditForStorage()` is
 * an ALLOWLIST: an unexpected key (at the top level or on a step) is refused rather than silently stored, so content can
 * never reach the table by being attached to the object. Every free-text field is length-capped and pattern-checked.
 *
 * Rows are append-only (a database trigger, migration 0017) and idempotent per `requestId`.
 */

export interface StoredOrchestrationAudit extends OrchestrationAudit {
  /** When the row was recorded (database clock). Distinct from `at`, when the orchestrator produced the audit. */
  recordedAt: string;
}

export type AuditAppendOutcome = "stored" | "duplicate";

/** The write side. A superset of the orchestrator's `OrchestrationAuditSink`, so it can be injected there unchanged. */
export interface OrchestrationAuditWriter extends OrchestrationAuditSink {
  record(entry: OrchestrationAudit): Promise<void>;
  /** Like `record`, but reports whether a new row was written. A repeat of an identical audit is `duplicate`; a DIFFERENT audit under the same request id is a `conflict`. */
  append(entry: OrchestrationAudit): Promise<AuditAppendOutcome>;
}

/**
 * Student-scoped reads. Every method takes the student id the caller has authenticated and can only ever return that
 * student's rows; another student's request id is indistinguishable from a missing one (`null`). Staff/orchestrator
 * rows (no student) are unreachable here.
 */
export interface StudentOrchestrationAuditReader {
  listForStudent(studentId: string, options?: { limit?: number }): Promise<StoredOrchestrationAudit[]>;
  getForStudent(studentId: string, requestId: string): Promise<StoredOrchestrationAudit | null>;
}

/**
 * Operator reads. A DIFFERENT interface on purpose: code that is only handed a `StudentOrchestrationAuditReader` cannot
 * reach another student's or a staff audit by type. Authorizing the operator (role check) is the caller's job and is NOT
 * done here - this layer never constructs a role.
 */
export interface OperatorOrchestrationAuditReader {
  findByRequestId(requestId: string): Promise<StoredOrchestrationAudit | null>;
}

export const AUDIT_LIMITS = Object.freeze({ DEFAULT_LIST: 50, MAX_LIST: 100, MAX_TEXT: 200, MAX_ID: 128, MAX_STEPS: 50 });

const ACTOR_KINDS = ["student", "staff"] as const;
const STATUSES = ["completed", "partial", "failed", "refused"] as const;
const STEP_STATUSES = ["succeeded", "failed", "skipped"] as const;
const SKIPPED_BECAUSE = ["dependency_failed", "stopped_after_failure", "optional_capability_unavailable"] as const;
const VALIDATION_STATUSES = ["passed", "failed", "not_applicable"] as const;
const AUDIT_KEYS = ["requestId", "at", "task", "workflowId", "actorKind", "studentId", "examCode", "status", "steps", "fallbackOccurred", "selectionRule", "decidedBy"] as const;
const STEP_KEYS = ["stepId", "capabilityId", "status", "skippedBecause", "inputDigest", "isFallback", "failureKind", "failureCode", "validationStatus"] as const;

const bad = (message: string): never => {
  throw new PersistenceError("invalid_record", `Orchestration audit refused: ${message}`);
};
const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const oneOf = <T extends string>(v: unknown, allowed: readonly T[], field: string): T => (typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : bad(`${field} is not one of the allowed values`));
const nullableOneOf = <T extends string>(v: unknown, allowed: readonly T[], field: string): T | null => (v === null ? null : oneOf(v, allowed, field));
const text = (v: unknown, field: string, max: number = AUDIT_LIMITS.MAX_TEXT): string => (typeof v === "string" && v.trim() !== "" && v.length <= max && ![...v].some((c) => c.charCodeAt(0) < 32) ? v : bad(`${field} must be a short single-line string`));
const nullableText = (v: unknown, field: string, max?: number): string | null => (v === null ? null : text(v, field, max));
const IDENTIFIER = /^[A-Za-z0-9_.:\-/]{1,80}$/;
const identifier = (v: unknown, field: string): string => (typeof v === "string" && IDENTIFIER.test(v) ? v : bad(`${field} must be a short identifier`));

/** Validates and re-builds an audit from its allowlisted fields only. Throws `PersistenceError("invalid_record")`; never returns extra data. */
export function sanitizeAuditForStorage(entry: unknown): OrchestrationAudit {
  if (!isRecord(entry)) return bad("the audit must be an object");
  for (const key of Object.keys(entry)) if (!(AUDIT_KEYS as readonly string[]).includes(key)) bad(`unexpected field "${key.slice(0, 40)}"`);
  const at = text(entry.at, "at", 40);
  if (Number.isNaN(Date.parse(at))) bad("at is not a timestamp");
  if (!Array.isArray(entry.steps) || entry.steps.length > AUDIT_LIMITS.MAX_STEPS) bad("steps must be a short list");
  const steps = (entry.steps as unknown[]).map((raw, i) => {
    if (!isRecord(raw)) return bad(`step ${i} must be an object`);
    for (const key of Object.keys(raw)) if (!(STEP_KEYS as readonly string[]).includes(key)) bad(`unexpected step field "${key.slice(0, 40)}"`);
    const digest = raw.inputDigest;
    if (digest !== null && !(typeof digest === "string" && /^[0-9a-f]{64}$/.test(digest))) bad("inputDigest must be a sha256 hex digest or null");
    if (typeof raw.isFallback !== "boolean") bad("isFallback must be a boolean");
    return {
      stepId: identifier(raw.stepId, "stepId"),
      capabilityId: oneOf(raw.capabilityId, CAPABILITY_IDS, "capabilityId"),
      status: oneOf(raw.status, STEP_STATUSES, "step status"),
      skippedBecause: nullableOneOf(raw.skippedBecause, SKIPPED_BECAUSE, "skippedBecause"),
      inputDigest: digest as string | null,
      isFallback: raw.isFallback as boolean,
      failureKind: nullableOneOf(raw.failureKind, FAILURE_KINDS, "failureKind"),
      failureCode: raw.failureCode === null ? null : identifier(raw.failureCode, "failureCode"),
      validationStatus: nullableOneOf(raw.validationStatus, VALIDATION_STATUSES, "validationStatus")
    };
  });
  if (typeof entry.fallbackOccurred !== "boolean") bad("fallbackOccurred must be a boolean");
  return {
    requestId: text(entry.requestId, "requestId", AUDIT_LIMITS.MAX_ID),
    at: new Date(at).toISOString(),
    task: oneOf(entry.task, TASK_IDS, "task"),
    workflowId: entry.workflowId === null ? null : identifier(entry.workflowId, "workflowId"),
    actorKind: oneOf(entry.actorKind, ACTOR_KINDS, "actorKind"),
    studentId: nullableText(entry.studentId, "studentId", AUDIT_LIMITS.MAX_ID),
    examCode: nullableText(entry.examCode, "examCode", 64),
    status: oneOf(entry.status, STATUSES, "status"),
    steps,
    fallbackOccurred: entry.fallbackOccurred as boolean,
    selectionRule: text(entry.selectionRule, "selectionRule"),
    decidedBy: text(entry.decidedBy, "decidedBy")
  };
}

const clampLimit = (limit: number | undefined): number => {
  if (limit === undefined) return AUDIT_LIMITS.DEFAULT_LIST;
  if (!Number.isInteger(limit) || limit < 1) throw new PersistenceError("invalid_record", "limit must be a positive integer.");
  return Math.min(limit, AUDIT_LIMITS.MAX_LIST);
};
const requireId = (v: unknown, what: string): string => (typeof v === "string" && v.trim() !== "" ? v : bad(`${what} is required`));
// Key-order-independent: Postgres jsonb does not preserve object key order, so a plain JSON.stringify comparison would call identical audits different.
const sortKeys = (v: unknown): unknown => (Array.isArray(v) ? v.map(sortKeys) : isRecord(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])])) : v);
const canonical = (a: OrchestrationAudit): string => JSON.stringify(sortKeys(a));

const copy = (a: StoredOrchestrationAudit): StoredOrchestrationAudit => JSON.parse(JSON.stringify(a)) as StoredOrchestrationAudit;

/**
 * Test double and reference for the contract the Prisma implementation satisfies. `knownStudentIds` plays the role of the
 * `students` table: a claimed student id that is not in it is stored as `null` (the foreign-key behaviour below).
 */
export class InMemoryOrchestrationAuditStore implements OrchestrationAuditWriter, StudentOrchestrationAuditReader, OperatorOrchestrationAuditReader {
  private readonly rows = new Map<string, StoredOrchestrationAudit>();
  constructor(
    private readonly knownStudentIds: ReadonlySet<string> = new Set<string>(),
    private readonly now: () => Date = () => new Date()
  ) {}

  async record(entry: OrchestrationAudit): Promise<void> {
    await this.append(entry);
  }

  async append(entry: OrchestrationAudit): Promise<AuditAppendOutcome> {
    const clean = sanitizeAuditForStorage(entry);
    const existing = this.rows.get(clean.requestId);
    if (existing) return resolveDuplicate(existing, clean, existing.studentId);
    const studentId = clean.studentId !== null && this.knownStudentIds.has(clean.studentId) ? clean.studentId : null;
    this.rows.set(clean.requestId, { ...clean, studentId, recordedAt: this.now().toISOString() });
    return "stored";
  }

  async listForStudent(studentId: string, options: { limit?: number } = {}): Promise<StoredOrchestrationAudit[]> {
    requireId(studentId, "a student id");
    const limit = clampLimit(options.limit);
    return [...this.rows.values()]
      .filter((r) => r.studentId === studentId)
      .sort((a, b) => (a.at === b.at ? 0 : a.at < b.at ? 1 : -1))
      .slice(0, limit)
      .map(copy);
  }

  async getForStudent(studentId: string, requestId: string): Promise<StoredOrchestrationAudit | null> {
    requireId(studentId, "a student id");
    const row = this.rows.get(requestId);
    return row && row.studentId === studentId ? copy(row) : null;
  }

  async findByRequestId(requestId: string): Promise<StoredOrchestrationAudit | null> {
    const row = this.rows.get(requestId);
    return row ? copy(row) : null;
  }
}

function resolveDuplicate(existing: OrchestrationAudit, incoming: OrchestrationAudit, storedStudentId: string | null): AuditAppendOutcome {
  // A duplicate is the SAME audit; the stored student id may have been nulled (unknown student / deleted student), so compare through it.
  const a = { ...incoming, studentId: storedStudentId };
  const { recordedAt: _recordedAt, ...stored } = existing as StoredOrchestrationAudit;
  void _recordedAt;
  if (canonical(a) === canonical(stored as OrchestrationAudit)) return "duplicate";
  throw new PersistenceError("conflict", "A different audit is already recorded under this request id.");
}

type AuditRow = {
  requestId: string;
  occurredAt: Date;
  task: string;
  workflowId: string | null;
  actorKind: string;
  studentId: string | null;
  examCode: string | null;
  status: string;
  fallbackOccurred: boolean;
  selectionRule: string;
  decidedBy: string;
  steps: Prisma.JsonValue;
  recordedAt: Date;
};

function toStored(row: AuditRow): StoredOrchestrationAudit {
  return {
    requestId: row.requestId,
    at: row.occurredAt.toISOString(),
    task: row.task as StoredOrchestrationAudit["task"],
    workflowId: row.workflowId,
    actorKind: row.actorKind as StoredOrchestrationAudit["actorKind"],
    studentId: row.studentId,
    examCode: row.examCode,
    status: row.status as StoredOrchestrationAudit["status"],
    steps: row.steps as unknown as StoredOrchestrationAudit["steps"],
    fallbackOccurred: row.fallbackOccurred,
    selectionRule: row.selectionRule,
    decidedBy: row.decidedBy,
    recordedAt: row.recordedAt.toISOString()
  };
}

/**
 * The ONE database-backed audit store. `append()` is a single INSERT (atomic by itself; no multi-statement transaction
 * is needed), made idempotent by the unique request id: two concurrent recordings of the same audit store one row.
 *
 * A claimed student id is UNTRUSTED when the request was refused before ownership was verified (the orchestrator audits
 * those too): if no such student exists the foreign key rejects it and the row is stored with `student_id = NULL` rather
 * than losing the audit - the unverified claim is not retained. The audit is then reachable only by an operator.
 */
export class PrismaOrchestrationAuditStore implements OrchestrationAuditWriter, StudentOrchestrationAuditReader, OperatorOrchestrationAuditReader {
  constructor(private readonly prisma: PrismaClient) {}

  async record(entry: OrchestrationAudit): Promise<void> {
    await this.append(entry);
  }

  async append(entry: OrchestrationAudit): Promise<AuditAppendOutcome> {
    const clean = sanitizeAuditForStorage(entry);
    const data = (studentId: string | null) => ({
      id: randomUUID(),
      requestId: clean.requestId,
      occurredAt: new Date(clean.at),
      task: clean.task,
      workflowId: clean.workflowId,
      actorKind: clean.actorKind,
      studentId,
      examCode: clean.examCode,
      status: clean.status,
      fallbackOccurred: clean.fallbackOccurred,
      selectionRule: clean.selectionRule,
      decidedBy: clean.decidedBy,
      steps: clean.steps as unknown as Prisma.InputJsonValue
    });
    const insert = async (studentId: string | null): Promise<AuditAppendOutcome> => {
      try {
        await this.prisma.orchestrationAudit.create({ data: data(studentId) });
        return "stored";
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError) {
          if (error.code === "P2002") return this.compareWithExisting(clean);
          if (error.code === "P2003" && studentId !== null) return insert(null);
        }
        throw error;
      }
    };
    return insert(clean.studentId);
  }

  private async compareWithExisting(clean: OrchestrationAudit): Promise<AuditAppendOutcome> {
    const existing = await this.prisma.orchestrationAudit.findUnique({ where: { requestId: clean.requestId } });
    if (!existing) throw new PersistenceError("conflict", "The audit could not be recorded or found under its request id."); // vanished between statements; the caller may retry
    const { recordedAt: _recordedAt, ...stored } = toStored(existing);
    void _recordedAt;
    return resolveDuplicate(stored as OrchestrationAudit, clean, stored.studentId);
  }

  async listForStudent(studentId: string, options: { limit?: number } = {}): Promise<StoredOrchestrationAudit[]> {
    requireId(studentId, "a student id");
    const rows = await this.prisma.orchestrationAudit.findMany({ where: { studentId }, orderBy: [{ occurredAt: "desc" }, { requestId: "asc" }], take: clampLimit(options.limit) });
    return rows.map(toStored);
  }

  async getForStudent(studentId: string, requestId: string): Promise<StoredOrchestrationAudit | null> {
    requireId(studentId, "a student id");
    const row = await this.prisma.orchestrationAudit.findFirst({ where: { studentId, requestId } });
    return row ? toStored(row) : null;
  }

  async findByRequestId(requestId: string): Promise<StoredOrchestrationAudit | null> {
    const row = await this.prisma.orchestrationAudit.findUnique({ where: { requestId } });
    return row ? toStored(row) : null;
  }
}
