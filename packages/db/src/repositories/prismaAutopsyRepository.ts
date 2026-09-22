import type { PrismaClient } from "@prisma/client";
import { toAutopsyPersistenceRecord, type AutopsyHypothesis, type AutopsyOutput } from "@ipmat/autopsy";
import { asJson } from "./json.js";
import type { AutopsyRepository, StoredAutopsy } from "./types.js";
import { assertAutopsyLinkage, assertErrorTaxonomyResolved } from "./validation.js";

/**
 * The ONE concrete adapter that actually calls `prisma.autopsy.*` — no
 * other code in this codebase does (matching Phase 5B's "do not pretend
 * persistence exists if no adapter is implemented"; this phase IS that
 * adapter). Compiles against the real generated Prisma Client types but,
 * like every other piece of this codebase, has never been run against a
 * live database (none has ever been reachable — see docs/MASTER_PLAN.md
 * "Current state").
 *
 * `save()` performs exactly one write (`autopsy.upsert`) — the
 * `errorTaxonomy.findUnique` beforehand is a read, not a second write, so
 * there is no multi-step write sequence that could leave a partially
 * written row; no transaction is needed here.
 */
export class PrismaAutopsyRepository implements AutopsyRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async save(input: { hypothesis: AutopsyHypothesis; output: AutopsyOutput }): Promise<StoredAutopsy> {
    const { hypothesis, output } = input;

    assertAutopsyLinkage(hypothesis, output);

    const proposedCode = output.candidateErrorEvidence?.proposedErrorTaxonomyCode ?? null;
    let resolvedErrorTaxonomyId: string | null = null;
    if (proposedCode) {
      const errorTaxonomy = await this.prisma.errorTaxonomy.findUnique({ where: { code: proposedCode } });
      const resolvedId = errorTaxonomy?.id ?? null;
      assertErrorTaxonomyResolved(proposedCode, resolvedId);
      resolvedErrorTaxonomyId = resolvedId;
    }

    const record = toAutopsyPersistenceRecord(hypothesis, output, resolvedErrorTaxonomyId);

    const row = await this.prisma.autopsy.upsert({
      where: { attemptId: record.attemptId },
      create: {
        attemptId: record.attemptId,
        hypothesisText: record.hypothesisText,
        errorTaxonomyId: record.errorTaxonomyId,
        likelyRootCause: record.likelyRootCause,
        evidenceUsed: asJson(record.evidenceUsed),
        confirmed: record.confirmed,
        studentCorrectionText: record.studentCorrectionText,
        generatedByProvider: record.generatedByProvider,
        promptVersion: record.promptVersion
      },
      update: {
        hypothesisText: record.hypothesisText,
        errorTaxonomyId: record.errorTaxonomyId,
        likelyRootCause: record.likelyRootCause,
        evidenceUsed: asJson(record.evidenceUsed),
        confirmed: record.confirmed,
        studentCorrectionText: record.studentCorrectionText,
        generatedByProvider: record.generatedByProvider,
        promptVersion: record.promptVersion
      }
    });

    return toStoredAutopsy(row);
  }

  async findByAttemptId(attemptId: string): Promise<StoredAutopsy | null> {
    const row = await this.prisma.autopsy.findUnique({ where: { attemptId } });
    return row ? toStoredAutopsy(row) : null;
  }
}

function toStoredAutopsy(row: {
  id: string;
  attemptId: string;
  hypothesisText: string;
  errorTaxonomyId: string | null;
  likelyRootCause: string | null;
  evidenceUsed: unknown;
  confirmed: boolean | null;
  studentCorrectionText: string | null;
  generatedByProvider: string;
  promptVersion: string;
  createdAt: Date;
}): StoredAutopsy {
  return {
    id: row.id,
    attemptId: row.attemptId,
    hypothesisText: row.hypothesisText,
    errorTaxonomyId: row.errorTaxonomyId,
    likelyRootCause: row.likelyRootCause,
    evidenceUsed: row.evidenceUsed as Record<string, unknown>,
    confirmed: row.confirmed,
    studentCorrectionText: row.studentCorrectionText,
    generatedByProvider: row.generatedByProvider,
    promptVersion: row.promptVersion,
    createdAt: row.createdAt.toISOString()
  };
}
