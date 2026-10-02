import { normalizeConceptNameKey } from "@ipmat/concept-graph";
import { ExamPackInvalidError, ExamPackNotFoundError, validateExamPack, type ExamPack, type ExamPackRepository } from "@ipmat/exam-pack";
import { chunkDocument, chunkProblems, DEFAULT_CHUNKER_CONFIG } from "./chunk.js";
import { acceptCandidate, createConceptMention, createQuestionCandidate, createRelationship, rejectCandidate } from "./candidates.js";
import { extractDocument, normalizeText, validateExtraction } from "./extract.js";
import type { ConceptExtractionProvider, RelationshipExtractionProvider } from "./providers.js";
import type { ContentIntelligenceRepository } from "./repository.js";
import { contentHash, registerableSource, sourceVersionIdFor } from "./source.js";
import {
  ContentIntelligenceError,
  PIPELINE_STAGES,
  type Candidate,
  type CandidateReview,
  type ChunkerConfig,
  type ExtractedDocument,
  type IngestionFailure,
  type IngestionState,
  type PipelineStage,
  type SourceFormat,
  type SourceInput,
  type SourceRecord,
  type SourceVersionRecord
} from "./types.js";

/**
 * The ingestion pipeline (docs/DECISIONS.md D-085):
 *
 *   registered -> accepted -> extracted -> normalized -> chunked -> enriched -> reviewed -> available
 *
 * Properties, each tested:
 *  - IDEMPOTENT: re-registering a source returns the same source; re-ingesting
 *    the same content returns the same version and does no work; every id is
 *    deterministic, so a re-run converges on the same rows.
 *  - VERSIONED: changed content is a NEW version; an existing version (and the
 *    validated intelligence hanging off it) is never overwritten.
 *  - FAILURE-TOLERANT: a failing stage records `failed` + the stage + a stable
 *    code (never source content) and stops; nothing already validated is
 *    touched; `run` again resumes from the failed stage.
 *  - RESUMABLE without storing the raw document: stages up to `chunked` need the
 *    content (re-supplied and verified against the stored hash); later stages
 *    work from the persisted chunks alone.
 *  - NEVER AUTHORITATIVE: enrichment only ever creates candidates.
 * It names no vendor and calls no model: providers are injected interfaces.
 */

export interface PipelineDeps {
  repo: ContentIntelligenceRepository;
  packs: ExamPackRepository;
  conceptProviders: readonly ConceptExtractionProvider[];
  relationshipProviders?: readonly RelationshipExtractionProvider[];
  chunker?: ChunkerConfig;
}

export interface IngestionResult {
  source: SourceRecord;
  version: SourceVersionRecord;
  /** True when this exact content had already been ingested (no new version was created). */
  unchanged: boolean;
  failure: IngestionFailure | null;
  /** Proposals a provider made that were REJECTED at creation (unverifiable evidence, unknown concept, unestablished relation type...). */
  proposalProblems: string[];
}

const STAGE_BEFORE: Record<PipelineStage, IngestionState> = { accepted: "registered", extracted: "accepted", normalized: "extracted", chunked: "normalized", enriched: "chunked" };
const norm = normalizeConceptNameKey;

export class ContentIntelligencePipeline {
  constructor(private readonly deps: PipelineDeps) {}

  private async pack(examCode: string): Promise<ExamPack> {
    const pack = await this.deps.packs.findByExamCode(examCode);
    if (!pack) throw new ExamPackNotFoundError(examCode);
    const result = validateExamPack(pack);
    if (!result.valid) throw new ExamPackInvalidError(examCode, result.issues.filter((i) => i.severity === "error"));
    return pack;
  }

  /** Throws `unauthorized_source` / `invalid_source` and persists NOTHING for a source that fails the rights or structure rules. Idempotent. */
  async registerSource(input: SourceInput): Promise<{ source: SourceRecord; alreadyExisted: boolean }> {
    const source = registerableSource(input);
    await this.pack(input.examCode); // a source can only belong to an exam that has a valid pack
    return this.deps.repo.registerSource(source);
  }

  /**
   * Ingests content for a registered source. Same content -> same version (no
   * work, unless a previous run failed or stopped early, in which case it
   * resumes). New content -> a new version.
   */
  async ingest(input: { examCode: string; sourceKey: string; format: SourceFormat; content: string }): Promise<IngestionResult> {
    const source = await this.deps.repo.findSource(input.examCode, input.sourceKey);
    if (!source) throw new ContentIntelligenceError("invalid_source", `no registered source "${input.sourceKey}" for exam "${input.examCode}"`);
    const hash = contentHash(input.content);
    const { version, alreadyExisted } = await this.deps.repo.addVersion(source.id, { id: sourceVersionIdFor(source.id, hash), contentHash: hash, format: input.format, byteLength: Buffer.byteLength(input.content, "utf8") });
    const settled: IngestionState[] = ["enriched", "reviewed", "available"];
    if (alreadyExisted && settled.includes(version.state)) return { source, version, unchanged: true, failure: null, proposalProblems: [] };
    const outcome = await this.run(version.id, input.content);
    return { ...outcome, source, unchanged: alreadyExisted };
  }

  /** Runs (or resumes) the stages for one version. Never throws for a content problem: it records the failure and returns it. */
  async run(versionId: string, content?: string): Promise<{ version: SourceVersionRecord; failure: IngestionFailure | null; proposalProblems: string[] }> {
    let version = (await this.deps.repo.findVersion(versionId))!;
    if (!version) throw new ContentIntelligenceError("invalid_transition", "unknown source version");
    const problems: string[] = [];
    if (content !== undefined && contentHash(content) !== version.contentHash) throw new ContentIntelligenceError("content_hash_mismatch", "the supplied content is not the content of this source version");

    if (version.state === "failed" && version.failure) {
      version = await this.deps.repo.updateVersionState(version.id, { state: STAGE_BEFORE[version.failure.stage], failure: null, incrementAttempts: true });
    } else if (version.state === "registered") {
      version = await this.deps.repo.updateVersionState(version.id, { state: "registered", failure: null, incrementAttempts: true });
    }
    const source = (await this.sourceOf(version))!;
    let doc: ExtractedDocument | null = null;

    for (const stage of PIPELINE_STAGES) {
      if (version.state !== STAGE_BEFORE[stage]) continue;
      try {
        if (stage === "accepted") {
          registerableSource(source); // re-check rights at the moment of acceptance: nothing stale is trusted
        } else if (stage === "extracted") {
          if (content === undefined) throw new ContentIntelligenceError("invalid_source", "the content is required to resume from this stage");
          doc = extractDocument(version.format, content);
        } else if (stage === "normalized") {
          if (!doc) {
            if (content === undefined) throw new ContentIntelligenceError("invalid_source", "the content is required to resume from this stage");
            doc = extractDocument(version.format, content);
          }
          validateExtraction(doc);
          if (normalizeText(doc.normalizedText) !== doc.normalizedText) throw new ContentIntelligenceError("invalid_extraction", "normalization is not stable");
        } else if (stage === "chunked") {
          if (!doc) {
            if (content === undefined) throw new ContentIntelligenceError("invalid_source", "the content is required to resume from this stage");
            doc = extractDocument(version.format, content);
          }
          const chunks = chunkDocument(doc, version.id, this.deps.chunker ?? DEFAULT_CHUNKER_CONFIG);
          const bad = chunkProblems(chunks, doc);
          if (bad.length > 0) throw new ContentIntelligenceError("invalid_extraction", `chunking violated its invariants: ${bad[0]}`);
          await this.deps.repo.replaceChunks(version.id, chunks);
        } else {
          problems.push(...(await this.enrich(version, source)));
        }
        version = await this.deps.repo.updateVersionState(version.id, { state: stage, failure: null });
      } catch (error) {
        if (error instanceof ContentIntelligenceError && error.code === "invalid_source" && /content is required/.test(error.message)) throw error; // a caller error, not a content failure
        const failure: IngestionFailure = { stage, code: error instanceof ContentIntelligenceError ? error.code : error instanceof ExamPackNotFoundError || error instanceof ExamPackInvalidError ? "pack_unavailable" : "stage_error", message: error instanceof ContentIntelligenceError ? error.message : `stage "${stage}" failed` };
        version = await this.deps.repo.updateVersionState(version.id, { state: "failed", failure });
        return { version, failure, proposalProblems: problems };
      }
    }
    return { version, failure: null, proposalProblems: problems };
  }

  private async sourceOf(version: SourceVersionRecord): Promise<SourceRecord | null> {
    return this.deps.repo.findSourceById(version.sourceId);
  }

  /** Enrichment: providers propose; every proposal becomes a candidate only if it passes the validators. */
  private async enrich(version: SourceVersionRecord, source: SourceRecord): Promise<string[]> {
    const pack = await this.pack(source.examCode);
    const chunks = await this.deps.repo.listChunks(version.id);
    const problems: string[] = [];
    const conceptKeyOf = (name: string): string | null => pack.concepts.find((c) => norm(c.name) === norm(name))?.key ?? null;

    for (const chunk of chunks) {
      const ctx = { pack, chunks };
      const batch: Candidate[] = [];
      for (const provider of this.deps.conceptProviders) {
        let raws;
        try {
          raws = await provider.proposeConcepts(chunk, { pack });
        } catch {
          throw new ContentIntelligenceError("provider_error", `provider "${provider.name}" failed while proposing concepts`);
        }
        for (const raw of raws) {
          const at = chunk.text.indexOf(raw.quote);
          if (raw.quote.trim() === "" || at < 0) { problems.push(`unverifiable_evidence: ${provider.name}`); continue; }
          try {
            batch.push(createConceptMention({ examCode: source.examCode, sourceVersionId: version.id, proposedName: raw.name, evidence: [{ chunkId: chunk.id, quote: raw.quote, charStart: at, charEnd: at + raw.quote.length }], proposer: { kind: provider.kind, proposedBy: provider.name } }, ctx));
          } catch (e) {
            problems.push(`${e instanceof ContentIntelligenceError ? e.code : "invalid_candidate"}: ${provider.name}`);
          }
        }
      }
      for (const provider of this.deps.relationshipProviders ?? []) {
        let raws;
        try {
          raws = await provider.proposeRelationships(chunk, { pack });
        } catch {
          throw new ContentIntelligenceError("provider_error", `provider "${provider.name}" failed while proposing relationships`);
        }
        for (const raw of raws) {
          const at = chunk.text.indexOf(raw.quote);
          const from = conceptKeyOf(raw.fromConceptName);
          const to = conceptKeyOf(raw.toConceptName);
          if (raw.quote.trim() === "" || at < 0) { problems.push(`unverifiable_evidence: ${provider.name}`); continue; }
          if (!from || !to) { problems.push(`unknown_concept: ${provider.name}`); continue; }
          try {
            batch.push(createRelationship({ examCode: source.examCode, sourceVersionId: version.id, fromConceptKey: from, toConceptKey: to, relationType: raw.relationType, rationale: raw.rationale, evidence: [{ chunkId: chunk.id, quote: raw.quote, charStart: at, charEnd: at + raw.quote.length }], proposer: { kind: provider.kind, proposedBy: provider.name } }, ctx));
          } catch (e) {
            problems.push(`${e instanceof ContentIntelligenceError ? e.code : "invalid_candidate"}: ${provider.name}`);
          }
        }
      }
      if (chunk.blockKinds.includes("question")) {
        const detected = extractDocument("plain_text", chunk.text).blocks.find((b) => b.kind === "question")?.question;
        if (detected) {
          const mentioned = pack.concepts.filter((c) => batch.some((x) => x.kind === "concept_mention" && x.conceptKey === c.key)).map((c) => c.key);
          batch.push(createQuestionCandidate({ examCode: source.examCode, sourceVersionId: version.id, detected, chunkId: chunk.id, conceptKeys: mentioned, proposer: { kind: "deterministic", proposedBy: "question-boundary-detector@1" } }, ctx));
        }
      }
      await this.deps.repo.saveCandidates(batch);
    }
    return problems;
  }

  async reviewCandidate(candidateId: string, decision: "accept" | "reject", review: CandidateReview): Promise<Candidate> {
    const candidate = await this.deps.repo.findCandidate(candidateId);
    if (!candidate) throw new ContentIntelligenceError("invalid_candidate", "unknown candidate");
    const decided = decision === "accept" ? acceptCandidate(candidate, review) : rejectCandidate(candidate, review);
    await this.deps.repo.decideCandidate(decided);
    return decided;
  }

  /** enriched -> reviewed, only when every candidate has been decided by a person. */
  async completeReview(versionId: string): Promise<SourceVersionRecord> {
    const version = await this.deps.repo.findVersion(versionId);
    if (!version) throw new ContentIntelligenceError("invalid_transition", "unknown source version");
    if (version.state !== "enriched") throw new ContentIntelligenceError("invalid_transition", `only an enriched version can be reviewed (this one is ${version.state})`);
    const pending = (await this.deps.repo.listCandidates(versionId)).filter((c) => c.state === "candidate");
    if (pending.length > 0) throw new ContentIntelligenceError("invalid_transition", `${pending.length} candidate(s) are still undecided`);
    return this.deps.repo.updateVersionState(versionId, { state: "reviewed", failure: null });
  }

  /** reviewed -> available: the version's ACCEPTED intelligence may now be used by downstream systems. */
  async makeAvailable(versionId: string): Promise<SourceVersionRecord> {
    const version = await this.deps.repo.findVersion(versionId);
    if (!version || version.state !== "reviewed") throw new ContentIntelligenceError("invalid_transition", "only a reviewed version can be made available");
    return this.deps.repo.updateVersionState(versionId, { state: "available", failure: null });
  }
}
