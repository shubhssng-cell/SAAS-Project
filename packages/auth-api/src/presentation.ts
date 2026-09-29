import type { StudentAccountPublicRecord } from "@ipmat/db";
import type { StudentAccountView } from "./types.js";

/** The ONLY place a `StudentAccountPublicRecord` is translated into what a client ever sees — already passwordHash-free by the repository layer's own type, but kept as an explicit, narrow mapping (never a raw `...record` spread) so adding a field to the repository record can never silently widen what a client receives. */
export function toStudentAccountView(record: StudentAccountPublicRecord): StudentAccountView {
  return { id: record.id, email: record.email, createdAt: record.createdAt, onboardingCompletedAt: record.onboardingCompletedAt };
}
