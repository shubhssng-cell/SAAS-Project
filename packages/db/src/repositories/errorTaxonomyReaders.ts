import type { PrismaClient } from "@prisma/client";
import type { ErrorTaxonomyEntry } from "@ipmat/autopsy";
import { errorTaxonomySeed } from "../../seed-data/errorTaxonomy.js";
import type { ErrorTaxonomyReader } from "./types.js";

/** Phase 4 Unit 3 -- the EXISTING `error_taxonomies` table, read-only, ordered by `code` for determinism. Never a second taxonomy. */
export class PrismaErrorTaxonomyReader implements ErrorTaxonomyReader {
  constructor(private readonly prisma: PrismaClient) {}

  async findAll(): Promise<ErrorTaxonomyEntry[]> {
    const rows = await this.prisma.errorTaxonomy.findMany({ orderBy: { code: "asc" } });
    return rows.map((row) => ({ code: row.code, label: row.label, description: row.description ?? "", category: row.category as ErrorTaxonomyEntry["category"] }));
  }
}

/** In-memory reader; defaults to the SAME curated seed the database is seeded with (`seed-data/errorTaxonomy.ts`), so there is still one vocabulary. */
export class InMemoryErrorTaxonomyReader implements ErrorTaxonomyReader {
  constructor(private readonly entries: ErrorTaxonomyEntry[] = errorTaxonomySeed) {}

  async findAll(): Promise<ErrorTaxonomyEntry[]> {
    return [...this.entries].sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
  }
}
