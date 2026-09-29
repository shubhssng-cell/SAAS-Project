import { randomUUID } from "node:crypto";
import { PersistenceError } from "./errors.js";
import type { StudentAccountPublicRecord, StudentAccountRecord, StudentAccountRepository } from "./types.js";

/** Test double for `StudentAccountRepository` — an in-memory `Student` table scoped to just the fields this port needs. */
export class InMemoryStudentAccountRepository implements StudentAccountRepository {
  private readonly byId = new Map<string, StudentAccountRecord>();
  private readonly idByEmail = new Map<string, string>();

  async create(input: { email: string; passwordHash: string; now: string }): Promise<StudentAccountPublicRecord> {
    if (this.idByEmail.has(input.email)) {
      throw new PersistenceError("invalid_record", "A student with this email already exists.");
    }
    const id = randomUUID();
    const record: StudentAccountRecord = { id, email: input.email, passwordHash: input.passwordHash, createdAt: input.now };
    this.byId.set(id, record);
    this.idByEmail.set(input.email, id);
    return toPublicRecord(record);
  }

  async findByEmailWithCredentials(email: string): Promise<StudentAccountRecord | null> {
    const id = this.idByEmail.get(email);
    if (!id) return null;
    return this.byId.get(id) ?? null;
  }

  async findById(studentId: string): Promise<StudentAccountPublicRecord | null> {
    const record = this.byId.get(studentId);
    return record ? toPublicRecord(record) : null;
  }
}

function toPublicRecord(record: StudentAccountRecord): StudentAccountPublicRecord {
  return { id: record.id, email: record.email, createdAt: record.createdAt };
}
