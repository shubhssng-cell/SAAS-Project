import type { ContentIntelligenceRepository } from "./repository.js";
import { ContentIntelligenceError, type ChunkValidationState, type SourceDataOrigin, type SourceLocation } from "./types.js";

/**
 * Retrieval (docs/DECISIONS.md D-085).
 *
 *   STRUCTURED INTELLIGENCE IS AUTHORITATIVE. EMBEDDINGS ARE RETRIEVAL AIDS.
 *
 * An index only ever answers "which chunks look relevant to this query" -
 * a ranked list of chunk IDS. It is never the source of truth for concept
 * identity, a prerequisite, question DNA, publication, rights or validation:
 * those live in the structured data, and a hit is resolved to content ONLY
 * through `EvidenceRetriever`, which re-checks the exam and the caller's
 * authorization against the structured data every time. An embedding can
 * therefore never bypass authorization.
 *
 * Nothing here is a chat product or a student feature. There is no vector
 * database: `VectorRetrievalIndex` is an in-memory implementation of an
 * interface any store could implement behind the same boundary.
 */

export interface RetrievalDocument {
  chunkId: string;
  examCode: string;
  sourceVersionId: string;
  dataOrigin: SourceDataOrigin;
  chunkState: ChunkValidationState;
  /** Given to an index so it can build its representation. A vector index keeps only the vector. */
  text: string;
}

export interface RetrievalQuery {
  /** Required: an index never searches across exams. */
  examCode: string;
  text: string;
  limit: number;
  /** Fixtures are excluded unless asked for. */
  includeFixtures?: boolean;
}

export interface RetrievalHit {
  chunkId: string;
  score: number;
  matchedBy: "lexical" | "vector";
}

export interface RetrievalIndex {
  readonly name: string;
  upsert(documents: readonly RetrievalDocument[]): Promise<void>;
  remove(chunkIds: readonly string[]): Promise<void>;
  /** Metadata filters (exam, fixture origin, rejected chunks) are applied BEFORE scoring. Deterministic order: score desc, chunkId asc. */
  search(query: RetrievalQuery): Promise<RetrievalHit[]>;
}

const tokenize = (text: string): string[] => text.toLowerCase().normalize("NFKC").split(/[^\p{L}\p{N}]+/u).filter((t) => t.length > 1);

interface IndexedMeta {
  examCode: string;
  dataOrigin: SourceDataOrigin;
  chunkState: ChunkValidationState;
}
const eligible = (m: IndexedMeta, q: RetrievalQuery): boolean => m.examCode === q.examCode && m.chunkState !== "rejected" && (q.includeFixtures === true || m.dataOrigin === "real_source");
const finish = (hits: RetrievalHit[], limit: number): RetrievalHit[] => hits.filter((h) => h.score > 0).sort((a, b) => b.score - a.score || (a.chunkId < b.chunkId ? -1 : 1)).slice(0, Math.max(0, limit));

/** The deterministic baseline: BM25-style term scoring over an in-memory inverted index. No model. */
export class LexicalRetrievalIndex implements RetrievalIndex {
  readonly name = "lexical-bm25@1";
  private readonly docs = new Map<string, IndexedMeta & { tf: Map<string, number>; length: number }>();

  async upsert(documents: readonly RetrievalDocument[]): Promise<void> {
    for (const d of documents) {
      const tf = new Map<string, number>();
      const tokens = tokenize(d.text);
      for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
      this.docs.set(d.chunkId, { examCode: d.examCode, dataOrigin: d.dataOrigin, chunkState: d.chunkState, tf, length: tokens.length });
    }
  }
  async remove(chunkIds: readonly string[]): Promise<void> {
    for (const id of chunkIds) this.docs.delete(id);
  }
  async search(query: RetrievalQuery): Promise<RetrievalHit[]> {
    const pool = [...this.docs.entries()].filter(([, m]) => eligible(m, query));
    if (pool.length === 0) return [];
    const avg = pool.reduce((s, [, m]) => s + m.length, 0) / pool.length || 1;
    const terms = [...new Set(tokenize(query.text))];
    const k1 = 1.2;
    const b = 0.75;
    const hits = pool.map(([chunkId, m]) => {
      let score = 0;
      for (const term of terms) {
        const f = m.tf.get(term) ?? 0;
        if (f === 0) continue;
        const df = pool.filter(([, x]) => x.tf.has(term)).length;
        const idf = Math.log(1 + (pool.length - df + 0.5) / (df + 0.5));
        score += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * m.length) / avg)));
      }
      return { chunkId, score, matchedBy: "lexical" as const };
    });
    return finish(hits, query.limit);
  }
}

/** Anything that turns text into vectors. Vendor-neutral: an API model, a local model, or the deterministic stand-in below. */
export interface EmbeddingProvider {
  readonly name: string;
  readonly dimensions: number;
  embed(texts: readonly string[]): Promise<number[][]>;
}

/**
 * A deterministic feature-hashing embedder. NOT a semantic model - it captures
 * word overlap only - and exists so the vector path can be exercised and
 * tested reproducibly with no vendor, key or network. Labelled as exactly that.
 */
export class HashingEmbeddingProvider implements EmbeddingProvider {
  readonly name = "hashing-embedder@1 (deterministic stand-in, not a semantic model)";
  constructor(readonly dimensions = 64) {}
  async embed(texts: readonly string[]): Promise<number[][]> {
    return texts.map((text) => {
      const v = new Array<number>(this.dimensions).fill(0);
      for (const token of tokenize(text)) {
        let h = 2166136261;
        for (let i = 0; i < token.length; i++) h = Math.imul(h ^ token.charCodeAt(i), 16777619) >>> 0;
        v[h % this.dimensions]! += 1;
      }
      const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
      return v.map((x) => x / norm);
    });
  }
}

/** Cosine search over stored vectors. Stores chunk ids, metadata and vectors - never the text. */
export class VectorRetrievalIndex implements RetrievalIndex {
  readonly name: string;
  private readonly rows = new Map<string, IndexedMeta & { vector: number[] }>();
  constructor(private readonly embedder: EmbeddingProvider) {
    this.name = `vector(${embedder.name})`;
  }
  async upsert(documents: readonly RetrievalDocument[]): Promise<void> {
    const vectors = await this.embedder.embed(documents.map((d) => d.text));
    documents.forEach((d, i) => {
      const vector = vectors[i];
      if (!vector || vector.length !== this.embedder.dimensions || vector.some((x) => !Number.isFinite(x))) throw new ContentIntelligenceError("invalid_candidate", "the embedding provider returned an invalid vector");
      this.rows.set(d.chunkId, { examCode: d.examCode, dataOrigin: d.dataOrigin, chunkState: d.chunkState, vector });
    });
  }
  async remove(chunkIds: readonly string[]): Promise<void> {
    for (const id of chunkIds) this.rows.delete(id);
  }
  async search(query: RetrievalQuery): Promise<RetrievalHit[]> {
    const pool = [...this.rows.entries()].filter(([, m]) => eligible(m, query)); // filter BEFORE scoring
    if (pool.length === 0) return [];
    const [q] = await this.embedder.embed([query.text]);
    if (!q) return [];
    const hits = pool.map(([chunkId, m]) => ({ chunkId, score: m.vector.reduce((s, x, i) => s + x * (q[i] ?? 0), 0), matchedBy: "vector" as const }));
    return finish(hits, query.limit);
  }
}

// ---------------------------------------------------------------------------
// Authorization
// ---------------------------------------------------------------------------

/**
 * Who is asking. There is NO student role that can read source content: the
 * source corpus is internal content-operations data. A future route must
 * construct a principal from real authentication; this package never trusts a
 * caller-asserted role beyond what it is handed.
 */
export type ContentRole = "content_admin" | "content_reviewer" | "student" | "anonymous";
export interface ContentPrincipal {
  role: ContentRole;
  /** The exams this principal may read. */
  examCodes: readonly string[];
}

const READERS: readonly ContentRole[] = ["content_admin", "content_reviewer"];

export class ContentAccessDeniedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContentAccessDeniedError";
  }
}

export interface RetrievedEvidence {
  chunkId: string;
  score: number;
  matchedBy: RetrievalHit["matchedBy"];
  text: string;
  location: SourceLocation;
  source: { sourceKey: string; title: string; version: number };
}

/**
 * Resolves index hits to content - the ONLY place retrieval touches text. It
 * (1) refuses any principal that is not content staff for this exam, (2)
 * resolves every hit through the exam-scoped structured repository, so an id
 * from another exam, a deleted chunk or a rejected chunk simply disappears,
 * and (3) never returns more than the structured data permits, whatever the
 * index says.
 */
export class EvidenceRetriever {
  constructor(private readonly repo: ContentIntelligenceRepository, private readonly index: RetrievalIndex) {}

  /** (Re)builds the index for one exam from the structured repository. Idempotent. */
  async indexExam(examCode: string): Promise<number> {
    const { sources, versions, chunks } = await this.repo.loadExam(examCode);
    const docs = chunks.flatMap((c) => {
      const version = versions.find((v) => v.id === c.sourceVersionId);
      const source = version ? sources.find((s) => s.id === version.sourceId) : undefined;
      return source ? [{ chunkId: c.id, examCode, sourceVersionId: c.sourceVersionId, dataOrigin: source.dataOrigin, chunkState: c.validationState, text: c.text }] : [];
    });
    await this.index.upsert(docs);
    return docs.length;
  }

  async retrieve(principal: ContentPrincipal, query: RetrievalQuery): Promise<RetrievedEvidence[]> {
    if (!READERS.includes(principal.role) || !principal.examCodes.includes(query.examCode)) throw new ContentAccessDeniedError("this principal may not read source content for this exam");
    const hits = await this.index.search(query);
    if (hits.length === 0) return [];
    const resolved = await this.repo.getChunks(query.examCode, hits.map((h) => h.chunkId));
    const byId = new Map(resolved.map((r) => [r.chunk.id, r]));
    return hits.flatMap((h) => {
      const r = byId.get(h.chunkId);
      if (!r || r.chunk.validationState === "rejected") return [];
      if (!query.includeFixtures && r.source.dataOrigin === "fixture") return [];
      return [{ chunkId: h.chunkId, score: h.score, matchedBy: h.matchedBy, text: r.chunk.text, location: r.chunk.location, source: { sourceKey: r.source.sourceKey, title: r.source.title, version: r.version.version } }];
    });
  }
}
