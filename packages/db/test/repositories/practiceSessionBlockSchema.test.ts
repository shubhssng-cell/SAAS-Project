import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_ROOT = join(__dirname, "..", "..");
const SCHEMA_PATH = join(DB_ROOT, "prisma", "schema.prisma");
const MIGRATION_PATH = join(DB_ROOT, "prisma", "migrations", "0006_practice_session_block", "migration.sql");

/**
 * D-060's schema/migration is hand-written (no live/shadow database has
 * ever been reachable in this environment — see docs/MASTER_PLAN.md
 * "Current state"), so it cannot be proved correct against a real Postgres
 * instance here. These are static checks that the negotiated invariants
 * are actually PRESENT in the SQL/schema text — a real substitute for "did
 * I forget to write the CHECK constraint," not a substitute for an actual
 * integration test against a live database (flagged explicitly in the
 * final implementation report).
 */
describe("D-060 schema/migration — static invariant checks", () => {
  const schema = readFileSync(SCHEMA_PATH, "utf-8");
  const migration = readFileSync(MIGRATION_PATH, "utf-8");

  it("schema.prisma declares PracticeSession with no studentId field", () => {
    const modelMatch = schema.match(/model PracticeSession \{[\s\S]*?\n\}/);
    expect(modelMatch).not.toBeNull();
    const model = modelMatch![0];
    expect(model).toContain("enrollmentId");
    expect(model).not.toMatch(/\bstudentId\b/);
  });

  it("schema.prisma declares PracticeBlock with no studentId/enrollmentId field", () => {
    const modelMatch = schema.match(/model PracticeBlock \{[\s\S]*?\n\}/);
    expect(modelMatch).not.toBeNull();
    const model = modelMatch![0];
    expect(model).toContain("practiceSessionId");
    expect(model).not.toMatch(/\bstudentId\b/);
    expect(model).not.toMatch(/\benrollmentId\b/);
  });

  it("schema.prisma declares Attempt.practiceBlockId with no practiceSessionId column", () => {
    const modelMatch = schema.match(/model Attempt \{[\s\S]*?\n\}/);
    expect(modelMatch).not.toBeNull();
    // Strip line comments before scanning -- the model's own doc comment legitimately
    // mentions "practiceSessionId" in prose, explaining why it is NOT a column here.
    const model = modelMatch![0].replace(/\/\/.*$/gm, "");
    expect(model).toContain("practiceBlockId");
    expect(model).toContain("blockSequenceNumber");
    expect(model).not.toMatch(/\bpracticeSessionId\b/);
  });

  it("schema.prisma declares the unique constraints for sequence numbering", () => {
    expect(schema).toContain("@@unique([practiceSessionId, sequenceNumber])");
    expect(schema).toContain("@@unique([practiceBlockId, blockSequenceNumber])");
  });

  it("all three new/touched FK relationships are onDelete: Restrict", () => {
    expect(schema).toMatch(/enrollment\s+Enrollment\s+@relation\(fields:\s*\[enrollmentId\],\s*references:\s*\[id\],\s*onDelete:\s*Restrict\)/);
    expect(schema).toMatch(/practiceSession\s+PracticeSession\s+@relation\(fields:\s*\[practiceSessionId\],\s*references:\s*\[id\],\s*onDelete:\s*Restrict\)/);
    expect(schema).toMatch(/practiceBlock\s+PracticeBlock\?\s+@relation\(fields:\s*\[practiceBlockId\],\s*references:\s*\[id\],\s*onDelete:\s*Restrict\)/);
  });

  it("migration.sql adds the paired-nullability CHECK constraint on attempts", () => {
    expect(migration).toMatch(/ADD CONSTRAINT "attempts_block_membership_pair"/);
    expect(migration).toMatch(/CHECK \(\("practice_block_id" IS NULL\) = \("block_sequence_number" IS NULL\)\)/);
  });

  it("migration.sql declares all three new FKs as ON DELETE RESTRICT", () => {
    const fkLines = migration.split("\n").filter((line) => line.includes("ADD CONSTRAINT") && line.includes("_fkey"));
    const restrictFkLines = migration.match(/ALTER TABLE "[a-z_]+" ADD CONSTRAINT "[a-z_]+_fkey" FOREIGN KEY[^;]+ON DELETE RESTRICT[^;]*;/g) ?? [];
    expect(fkLines.length).toBe(3);
    expect(restrictFkLines.length).toBe(3);
  });

  it("migration.sql creates both PracticeSessionStatus and PracticeBlockStatus enums with exactly active/completed/abandoned", () => {
    expect(migration).toContain(`CREATE TYPE "PracticeSessionStatus" AS ENUM ('active', 'completed', 'abandoned');`);
    expect(migration).toContain(`CREATE TYPE "PracticeBlockStatus" AS ENUM ('active', 'completed', 'abandoned');`);
  });

  it("migration.sql never CASCADEs a new/touched relationship (docs/DECISIONS.md D-060, Round 4)", () => {
    const newFkBlock = migration.slice(migration.indexOf("-- AddForeignKey"));
    expect(newFkBlock).not.toContain("ON DELETE CASCADE");
  });
});
