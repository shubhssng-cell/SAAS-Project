import { NO_PREFERENCES, validatePreferencePatch, type PreferenceStore, type StudentPreferences } from "@ipmat/personalization";
import { Prisma, type PrismaClient } from "@prisma/client";
import { PersistenceError } from "./errors.js";

const NON_BLANK = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";

/**
 * The durable `PreferenceStore` (Phase 9 Unit 1, docs/DECISIONS.md D-097) - the persistence D-095 deliberately left
 * unbuilt until a writer existed. It implements the domain's own port; the domain package never sees Prisma.
 *
 * AUTHORITATIVE data: only a student's own explicit choice ever reaches it (the single input is the validated patch;
 * nothing here reads attempts, mastery or any other evidence). Keyed STRICTLY by the student id the caller has already
 * authenticated - there is no list, no search by value and no cross-student read, so one student's row is unreachable
 * through another's key.
 *
 * `set()` is an upsert that writes ONLY the fields the patch mentions, so two concurrent patches to different fields
 * both survive (no read-modify-write window), and an `explicit null` clears one preference. An unknown student id is a
 * `missing_reference` (the foreign key), never a silently created orphan.
 */
export class PrismaPreferenceStore implements PreferenceStore {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly now: () => Date = () => new Date()
  ) {}

  async get(studentId: string): Promise<StudentPreferences> {
    this.requireId(studentId);
    const row = await this.prisma.studentPreference.findUnique({ where: { studentId } });
    if (!row) return { ...NO_PREFERENCES };
    return toPreferences(row);
  }

  async set(studentId: string, patch: unknown): Promise<StudentPreferences> {
    this.requireId(studentId);
    const validated = validatePreferencePatch(patch); // PreferenceError for any field that is not one of the three choices
    if (Object.keys(validated).length === 0) return this.get(studentId); // nothing mentioned: nothing to write
    const now = this.now();
    try {
      const row = await this.prisma.studentPreference.upsert({
        where: { studentId },
        create: { studentId, ...validated, updatedAt: now },
        update: { ...validated, updatedAt: now }
      });
      return toPreferences(row);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
        throw new PersistenceError("missing_reference", "No such student: a preference can only be stored for an existing student.");
      }
      throw error;
    }
  }

  /** Deletes the student's preference row (deletable by design: a preference is the student's own data). Returns whether a row existed. */
  async erase(studentId: string): Promise<boolean> {
    this.requireId(studentId);
    const { count } = await this.prisma.studentPreference.deleteMany({ where: { studentId } });
    return count > 0;
  }

  private requireId(studentId: string): void {
    if (!NON_BLANK(studentId)) throw new PersistenceError("invalid_record", "A student id is required.");
  }
}

function toPreferences(row: { language: string | null; verbosity: string | null; preferredHelp: string | null }): StudentPreferences {
  // The CHECK constraints guarantee these are in the closed vocabularies; the cast only restores the narrow union types.
  return { language: row.language as StudentPreferences["language"], verbosity: row.verbosity as StudentPreferences["verbosity"], preferredHelp: row.preferredHelp as StudentPreferences["preferredHelp"] };
}
