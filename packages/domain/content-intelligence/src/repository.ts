import {
  ContentIntelligenceError,
  type Candidate,
  type Chunk,
  type ChunkValidationState,
  type IngestionFailure,
  type IngestionState,
  type SourceFormat,
  type SourceRecord,
  type SourceVersionRecord
} from "./types.js";

/**
 * Persistence boundary for the content pipeline. INTERNAL: it holds extracted
 * source text and candidate evidence, and nothing student-facing may read it.
 * Writes are idempotent by construction (deterministic ids), validated content
 * is protected (a reviewed/available version's chunks cannot be replaced, a
 * decided candidate cannot be overwritten) and every read is exam-scoped.
 */
export interface ContentIntelligenceRepository {
  registerSource(source: SourceRecord): Promise<{ source: SourceRecord; alreadyExisted: boolean }>;
  findSource(examCode: string, sourceKey: string): Promise<SourceRecord | null>;
  findSourceById(id: string): Promise<SourceRecord | null>;
  listSources(examCode: string): Promise<SourceRecord[]>;
  /** Idempotent by (source, content hash): the same content is the same version and is never created twice. */
  addVersion(sourceId: string, input: { id: string; contentHash: string; format: SourceFormat; byteLength: number }): Promise<{ version: SourceVersionRecord; alreadyExisted: boolean }>;
  findVersion(id: string): Promise<SourceVersionRecord | null>;
  listVersions(sourceId: string): Promise<SourceVersionRecord[]>;
  updateVersionState(id: string, patch: { state: IngestionState; failure: IngestionFailure | null; incrementAttempts?: boolean }): Promise<SourceVersionRecord>;
  /** Atomically replaces a version's chunks. Refused once the version is `reviewed` or `available`. */
  replaceChunks(versionId: string, chunks: readonly Chunk[]): Promise<void>;
  listChunks(versionId: string): Promise<Chunk[]>;
  setChunkValidation(chunkId: string, state: ChunkValidationState): Promise<void>;
  /** Chunks with their source and version, scoped to one exam (an id from another exam is simply absent). */
  getChunks(examCode: string, chunkIds: readonly string[]): Promise<Array<{ chunk: Chunk; source: SourceRecord; version: SourceVersionRecord }>>;
  /** Upserts by deterministic id. A candidate that has already been decided is NEVER overwritten by a re-run. */
  saveCandidates(candidates: readonly Candidate[]): Promise<void>;
  /** Persists a reviewer's decision on a still-undecided candidate. */
  decideCandidate(candidate: Candidate): Promise<void>;
  findCandidate(id: string): Promise<Candidate | null>;
  listCandidates(sourceVersionId: string): Promise<Candidate[]>;
  /** Everything for one exam, for building the knowledge graph. */
  loadExam(examCode: string): Promise<{ sources: SourceRecord[]; versions: SourceVersionRecord[]; chunks: Chunk[]; candidates: Candidate[] }>;
}

const LOCKED: readonly IngestionState[] = ["reviewed", "available"];

export class InMemoryContentIntelligenceRepository implements ContentIntelligenceRepository {
  private readonly sources = new Map<string, SourceRecord>();
  private readonly versions = new Map<string, SourceVersionRecord>();
  private readonly chunks = new Map<string, Chunk[]>();
  private readonly candidates = new Map<string, Candidate>();

  async registerSource(source: SourceRecord) {
    const existing = this.sources.get(source.id);
    if (existing) return { source: structuredClone(existing), alreadyExisted: true };
    this.sources.set(source.id, structuredClone(source));
    return { source: structuredClone(source), alreadyExisted: false };
  }
  async findSource(examCode: string, sourceKey: string) {
    const s = [...this.sources.values()].find((x) => x.examCode === examCode && x.sourceKey === sourceKey);
    return s ? structuredClone(s) : null;
  }
  async findSourceById(id: string) {
    const s = this.sources.get(id);
    return s ? structuredClone(s) : null;
  }
  async listSources(examCode: string) {
    return [...this.sources.values()].filter((s) => s.examCode === examCode).sort((a, b) => (a.sourceKey < b.sourceKey ? -1 : 1)).map((s) => structuredClone(s));
  }
  async addVersion(sourceId: string, input: { id: string; contentHash: string; format: SourceFormat; byteLength: number }) {
    if (!this.sources.has(sourceId)) throw new ContentIntelligenceError("invalid_source", "unknown source");
    const siblings = [...this.versions.values()].filter((v) => v.sourceId === sourceId);
    const same = siblings.find((v) => v.contentHash === input.contentHash);
    if (same) return { version: structuredClone(same), alreadyExisted: true };
    const version: SourceVersionRecord = { id: input.id, sourceId, version: siblings.length + 1, contentHash: input.contentHash, format: input.format, byteLength: input.byteLength, state: "registered", failure: null, attempts: 0 };
    this.versions.set(version.id, version);
    return { version: structuredClone(version), alreadyExisted: false };
  }
  async findVersion(id: string) {
    const v = this.versions.get(id);
    return v ? structuredClone(v) : null;
  }
  async listVersions(sourceId: string) {
    return [...this.versions.values()].filter((v) => v.sourceId === sourceId).sort((a, b) => a.version - b.version).map((v) => structuredClone(v));
  }
  async updateVersionState(id: string, patch: { state: IngestionState; failure: IngestionFailure | null; incrementAttempts?: boolean }) {
    const v = this.versions.get(id);
    if (!v) throw new ContentIntelligenceError("invalid_transition", "unknown version");
    v.state = patch.state;
    v.failure = patch.failure ? { ...patch.failure } : null;
    if (patch.incrementAttempts) v.attempts += 1;
    return structuredClone(v);
  }
  async replaceChunks(versionId: string, chunks: readonly Chunk[]) {
    const v = this.versions.get(versionId);
    if (!v) throw new ContentIntelligenceError("invalid_transition", "unknown version");
    if (LOCKED.includes(v.state)) throw new ContentIntelligenceError("invalid_transition", `chunks of a ${v.state} version are locked`);
    this.chunks.set(versionId, structuredClone([...chunks]));
  }
  async listChunks(versionId: string) {
    return structuredClone(this.chunks.get(versionId) ?? []);
  }
  async setChunkValidation(chunkId: string, state: ChunkValidationState) {
    for (const list of this.chunks.values()) for (const c of list) if (c.id === chunkId) c.validationState = state;
  }
  async getChunks(examCode: string, chunkIds: readonly string[]) {
    const out: Array<{ chunk: Chunk; source: SourceRecord; version: SourceVersionRecord }> = [];
    for (const id of chunkIds) {
      for (const [versionId, list] of this.chunks) {
        const chunk = list.find((c) => c.id === id);
        const version = this.versions.get(versionId);
        const source = version ? this.sources.get(version.sourceId) : undefined;
        if (chunk && version && source && source.examCode === examCode) out.push(structuredClone({ chunk, source, version }));
      }
    }
    return out;
  }
  async saveCandidates(candidates: readonly Candidate[]) {
    for (const c of candidates) {
      const existing = this.candidates.get(c.id);
      if (existing && existing.state !== "candidate") continue; // decided: never overwritten by a re-run
      this.candidates.set(c.id, structuredClone(c));
    }
  }
  async decideCandidate(candidate: Candidate) {
    const existing = this.candidates.get(candidate.id);
    if (!existing) throw new ContentIntelligenceError("invalid_candidate", "unknown candidate");
    if (existing.state !== "candidate") throw new ContentIntelligenceError("invalid_transition", `candidate is already ${existing.state}`);
    this.candidates.set(candidate.id, structuredClone(candidate));
  }
  async findCandidate(id: string) {
    const c = this.candidates.get(id);
    return c ? structuredClone(c) : null;
  }
  async listCandidates(sourceVersionId: string) {
    return [...this.candidates.values()].filter((c) => c.sourceVersionId === sourceVersionId).sort((a, b) => (a.id < b.id ? -1 : 1)).map((c) => structuredClone(c));
  }
  async loadExam(examCode: string) {
    const sources = await this.listSources(examCode);
    const versions = (await Promise.all(sources.map((s) => this.listVersions(s.id)))).flat();
    const chunks = (await Promise.all(versions.map((v) => this.listChunks(v.id)))).flat();
    const versionIds = new Set(versions.map((v) => v.id));
    const candidates = [...this.candidates.values()].filter((c) => versionIds.has(c.sourceVersionId)).sort((a, b) => (a.id < b.id ? -1 : 1)).map((c) => structuredClone(c));
    return { sources, versions, chunks, candidates };
  }
}
