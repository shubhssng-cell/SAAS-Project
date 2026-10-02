import { Prisma, type PrismaClient } from "@prisma/client";
import {
  ContentIntelligenceError,
  type Candidate,
  type Chunk,
  type ChunkValidationState,
  type ContentIntelligenceRepository,
  type IngestionFailure,
  type IngestionState,
  type PipelineStage,
  type SourceFormat,
  type SourceRecord,
  type SourceVersionRecord
} from "@ipmat/content-intelligence";
import { PersistenceError } from "./errors.js";
import { asJson } from "./json.js";

/**
 * The ONE concrete, database-backed `ContentIntelligenceRepository`
 * (docs/DECISIONS.md D-085, migration 0015). INTERNAL: it stores extracted
 * source text and candidate evidence; no student reader selects from these
 * tables.
 *
 * Guarantees, each tested against real Postgres:
 *  - IDEMPOTENT: source and version ids are deterministic and unique-indexed;
 *    re-registering returns the same row; the same content never makes a second
 *    version; candidates are inserted with ON CONFLICT DO NOTHING so a re-run
 *    never overwrites one (least of all a decided one).
 *  - PROTECTED: a `reviewed`/`available` version's chunks cannot be replaced; a
 *    decision on a candidate is applied only to a still-undecided row; the
 *    rights rules are database CHECKs too, so an unauthorized source cannot be
 *    persisted even if the application layer is bypassed.
 *  - EXAM-SCOPED: every read joins through the source's exam.
 */
export class PrismaContentIntelligenceRepository implements ContentIntelligenceRepository {
  constructor(private readonly prisma: PrismaClient) {}

  private async examId(examCode: string): Promise<string> {
    const exam = await this.prisma.exam.findUnique({ where: { code: examCode }, select: { id: true } });
    if (!exam) throw new PersistenceError("missing_reference", `no exam with code "${examCode}"`);
    return exam.id;
  }

  async registerSource(source: SourceRecord) {
    const examId = await this.examId(source.examCode);
    const existing = await this.prisma.contentSource.findUnique({ where: { examId_sourceKey: { examId, sourceKey: source.sourceKey } }, include: { exam: { select: { code: true } } } });
    if (existing) return { source: toSource(existing), alreadyExisted: true };
    try {
      const row = await this.prisma.contentSource.create({
        data: { id: source.id, examId, sourceKey: source.sourceKey, title: source.title, sourceType: source.sourceType, sourceRef: source.sourceRef, licenseRef: source.licenseRef, attributedTo: source.attributedTo, authority: source.authority, dataOrigin: source.dataOrigin, fixtureLabel: source.fixtureLabel },
        include: { exam: { select: { code: true } } }
      });
      return { source: toSource(row), alreadyExisted: false };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const winner = await this.prisma.contentSource.findUniqueOrThrow({ where: { examId_sourceKey: { examId, sourceKey: source.sourceKey } }, include: { exam: { select: { code: true } } } });
        return { source: toSource(winner), alreadyExisted: true };
      }
      throw error;
    }
  }

  async findSource(examCode: string, sourceKey: string) {
    const row = await this.prisma.contentSource.findFirst({ where: { sourceKey, exam: { code: examCode } }, include: { exam: { select: { code: true } } } });
    return row ? toSource(row) : null;
  }

  async findSourceById(id: string) {
    const row = await this.prisma.contentSource.findUnique({ where: { id }, include: { exam: { select: { code: true } } } });
    return row ? toSource(row) : null;
  }

  async listSources(examCode: string) {
    const rows = await this.prisma.contentSource.findMany({ where: { exam: { code: examCode } }, orderBy: { sourceKey: "asc" }, include: { exam: { select: { code: true } } } });
    return rows.map(toSource);
  }

  async addVersion(sourceId: string, input: { id: string; contentHash: string; format: SourceFormat; byteLength: number }) {
    const attempt = async () =>
      this.prisma.$transaction(
        async (tx) => {
          const same = await tx.contentSourceVersion.findUnique({ where: { sourceId_contentHash: { sourceId, contentHash: input.contentHash } } });
          if (same) return { version: toVersion(same), alreadyExisted: true };
          if (!(await tx.contentSource.findUnique({ where: { id: sourceId }, select: { id: true } }))) throw new ContentIntelligenceError("invalid_source", "unknown source");
          const max = await tx.contentSourceVersion.aggregate({ where: { sourceId }, _max: { version: true } });
          const row = await tx.contentSourceVersion.create({ data: { id: input.id, sourceId, version: (max._max.version ?? 0) + 1, contentHash: input.contentHash, format: input.format, byteLength: input.byteLength, state: "registered", attempts: 0 } });
          return { version: toVersion(row), alreadyExisted: false };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      );
    try {
      return await attempt();
    } catch (error) {
      // A concurrent ingest of the same content lost the race (unique index or serialization failure): the winner's row IS the answer.
      if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2002" || error.code === "P2034")) return attempt();
      throw error;
    }
  }

  async findVersion(id: string) {
    const row = await this.prisma.contentSourceVersion.findUnique({ where: { id } });
    return row ? toVersion(row) : null;
  }

  async listVersions(sourceId: string) {
    return (await this.prisma.contentSourceVersion.findMany({ where: { sourceId }, orderBy: { version: "asc" } })).map(toVersion);
  }

  async updateVersionState(id: string, patch: { state: IngestionState; failure: IngestionFailure | null; incrementAttempts?: boolean }) {
    const row = await this.prisma.contentSourceVersion.update({
      where: { id },
      data: {
        state: patch.state,
        failureStage: patch.failure?.stage ?? null,
        failureCode: patch.failure?.code ?? null,
        failureMessage: patch.failure?.message ?? null,
        ...(patch.incrementAttempts ? { attempts: { increment: 1 } } : {})
      }
    });
    return toVersion(row);
  }

  async replaceChunks(versionId: string, chunks: readonly Chunk[]) {
    await this.prisma.$transaction(
      async (tx) => {
        const version = await tx.contentSourceVersion.findUnique({ where: { id: versionId }, select: { state: true } });
        if (!version) throw new ContentIntelligenceError("invalid_transition", "unknown version");
        if (version.state === "reviewed" || version.state === "available") throw new ContentIntelligenceError("invalid_transition", `chunks of a ${version.state} version are locked`);
        const keep = new Set(chunks.map((c) => c.id));
        const existing = await tx.contentChunk.findMany({ where: { sourceVersionId: versionId }, select: { id: true, _count: { select: { evidence: true } } } });
        const stale = existing.filter((c) => !keep.has(c.id));
        if (stale.some((c) => c._count.evidence > 0)) throw new ContentIntelligenceError("invalid_transition", "a chunk that is cited as evidence cannot be replaced");
        if (stale.length > 0) await tx.contentChunk.deleteMany({ where: { id: { in: stale.map((c) => c.id) } } });
        // Deterministic ids: re-chunking the same input converges on the same rows (existing rows are left exactly as they are).
        await tx.contentChunk.createMany({ data: chunks.map((c) => chunkData(c)), skipDuplicates: true });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
  }

  async listChunks(versionId: string) {
    return (await this.prisma.contentChunk.findMany({ where: { sourceVersionId: versionId }, orderBy: { ordinal: "asc" } })).map(toChunk);
  }

  async setChunkValidation(chunkId: string, state: ChunkValidationState) {
    await this.prisma.contentChunk.update({ where: { id: chunkId }, data: { validationState: state } });
  }

  async getChunks(examCode: string, chunkIds: readonly string[]) {
    if (chunkIds.length === 0) return [];
    const rows = await this.prisma.contentChunk.findMany({ where: { id: { in: [...chunkIds] }, sourceVersion: { source: { exam: { code: examCode } } } }, include: { sourceVersion: { include: { source: { include: { exam: { select: { code: true } } } } } } } });
    return rows.map((r) => ({ chunk: toChunk(r), version: toVersion(r.sourceVersion), source: toSource(r.sourceVersion.source) }));
  }

  async saveCandidates(candidates: readonly Candidate[]) {
    for (const c of candidates) {
      await this.prisma.$transaction(async (tx) => {
        // ON CONFLICT DO NOTHING semantics: never overwrite (a re-run must not reopen or alter a decided candidate).
        if (await tx.contentCandidate.findUnique({ where: { id: c.id }, select: { id: true } })) return;
        await tx.contentCandidate.create({
          data: { id: c.id, sourceVersionId: c.sourceVersionId, kind: c.kind, state: c.state, proposerKind: c.proposer.kind, proposedBy: c.proposer.proposedBy, reviewedBy: c.review?.reviewedBy ?? null, reviewedAt: c.review ? new Date(c.review.reviewedAt) : null, payload: asJson(payloadOf(c)) }
        });
        await tx.contentCandidateEvidence.createMany({ data: c.evidence.map((e, i) => ({ candidateId: c.id, ordinal: i, chunkId: e.chunkId, quote: e.quote, charStart: e.charStart, charEnd: e.charEnd })) });
      });
    }
  }

  async decideCandidate(candidate: Candidate) {
    if (candidate.state === "candidate" || !candidate.review) throw new ContentIntelligenceError("invalid_transition", "a decision needs an accepted/rejected state and a review");
    const result = await this.prisma.contentCandidate.updateMany({
      where: { id: candidate.id, state: "candidate" },
      data: { state: candidate.state, reviewedBy: candidate.review.reviewedBy, reviewedAt: new Date(candidate.review.reviewedAt) }
    });
    if (result.count === 0) {
      const existing = await this.prisma.contentCandidate.findUnique({ where: { id: candidate.id }, select: { state: true } });
      throw new ContentIntelligenceError(existing ? "invalid_transition" : "invalid_candidate", existing ? `candidate is already ${existing.state}` : "unknown candidate");
    }
  }

  async findCandidate(id: string) {
    const row = await this.prisma.contentCandidate.findUnique({ where: { id }, include: CANDIDATE_INCLUDE });
    return row ? toCandidate(row) : null;
  }

  async listCandidates(sourceVersionId: string) {
    return (await this.prisma.contentCandidate.findMany({ where: { sourceVersionId }, orderBy: { id: "asc" }, include: CANDIDATE_INCLUDE })).map(toCandidate);
  }

  async loadExam(examCode: string) {
    const sources = await this.listSources(examCode);
    const versions = (await this.prisma.contentSourceVersion.findMany({ where: { source: { exam: { code: examCode } } }, orderBy: [{ sourceId: "asc" }, { version: "asc" }] })).map(toVersion);
    const chunks = (await this.prisma.contentChunk.findMany({ where: { sourceVersion: { source: { exam: { code: examCode } } } }, orderBy: [{ sourceVersionId: "asc" }, { ordinal: "asc" }] })).map(toChunk);
    const candidates = (await this.prisma.contentCandidate.findMany({ where: { sourceVersion: { source: { exam: { code: examCode } } } }, orderBy: { id: "asc" }, include: CANDIDATE_INCLUDE })).map(toCandidate);
    return { sources, versions, chunks, candidates };
  }
}

const CANDIDATE_INCLUDE = { evidence: { orderBy: { ordinal: "asc" as const } }, sourceVersion: { select: { source: { select: { exam: { select: { code: true } } } } } } } satisfies Prisma.ContentCandidateInclude;

type SourceRow = Prisma.ContentSourceGetPayload<{ include: { exam: { select: { code: true } } } }>;
const toSource = (r: SourceRow): SourceRecord => ({ id: r.id, examCode: r.exam.code, sourceKey: r.sourceKey, title: r.title, sourceType: r.sourceType, sourceRef: r.sourceRef, licenseRef: r.licenseRef, attributedTo: r.attributedTo, authority: r.authority, dataOrigin: r.dataOrigin, fixtureLabel: r.fixtureLabel });

const toVersion = (r: Prisma.ContentSourceVersionGetPayload<object>): SourceVersionRecord => ({
  id: r.id,
  sourceId: r.sourceId,
  version: r.version,
  contentHash: r.contentHash,
  format: r.format as SourceFormat,
  byteLength: r.byteLength,
  state: r.state,
  failure: r.failureStage && r.failureCode && r.failureMessage ? { stage: r.failureStage as PipelineStage, code: r.failureCode, message: r.failureMessage } : null,
  attempts: r.attempts
});

const chunkData = (c: Chunk) => ({ id: c.id, sourceVersionId: c.sourceVersionId, ordinal: c.ordinal, text: c.text, textHash: c.textHash, headingPath: c.location.headingPath, lineStart: c.location.lineStart, lineEnd: c.location.lineEnd, charStart: c.location.charStart, charEnd: c.location.charEnd, blockKinds: c.blockKinds, validationState: c.validationState });
const toChunk = (r: Prisma.ContentChunkGetPayload<object>): Chunk => ({
  id: r.id,
  sourceVersionId: r.sourceVersionId,
  ordinal: r.ordinal,
  text: r.text,
  textHash: r.textHash,
  location: { lineStart: r.lineStart, lineEnd: r.lineEnd, charStart: r.charStart, charEnd: r.charEnd, page: null, headingPath: r.headingPath },
  blockKinds: r.blockKinds as Chunk["blockKinds"],
  validationState: r.validationState
});

function payloadOf(c: Candidate): Record<string, unknown> {
  if (c.kind === "concept_mention") return { proposedName: c.proposedName, conceptKey: c.conceptKey };
  if (c.kind === "relationship") return { fromConceptKey: c.fromConceptKey, toConceptKey: c.toConceptKey, relationType: c.relationType, rationale: c.rationale };
  return { detected: c.detected, conceptKeys: c.conceptKeys };
}

function toCandidate(r: Prisma.ContentCandidateGetPayload<{ include: typeof CANDIDATE_INCLUDE }>): Candidate {
  const base = {
    id: r.id,
    examCode: r.sourceVersion.source.exam.code,
    sourceVersionId: r.sourceVersionId,
    proposer: { kind: r.proposerKind, proposedBy: r.proposedBy },
    evidence: r.evidence.map((e) => ({ chunkId: e.chunkId, quote: e.quote, charStart: e.charStart, charEnd: e.charEnd })),
    state: r.state,
    review: r.reviewedBy && r.reviewedAt ? { reviewedBy: r.reviewedBy, reviewedAt: r.reviewedAt.toISOString() } : null
  };
  const p = r.payload as Record<string, unknown>;
  if (r.kind === "concept_mention") return { ...base, kind: "concept_mention", proposedName: p.proposedName as string, conceptKey: (p.conceptKey as string | null) ?? null };
  if (r.kind === "relationship") return { ...base, kind: "relationship", fromConceptKey: p.fromConceptKey as string, toConceptKey: p.toConceptKey as string, relationType: p.relationType as never, rationale: p.rationale as string };
  return { ...base, kind: "question", detected: p.detected as never, conceptKeys: p.conceptKeys as string[] };
}
