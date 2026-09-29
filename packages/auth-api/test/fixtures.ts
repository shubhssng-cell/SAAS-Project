import { InMemorySessionRepository, InMemoryStudentAccountRepository } from "@ipmat/db";
import { AuthApiService } from "../src/service.js";
import type { AuthApiDependencies } from "../src/types.js";

export const t = (offsetSeconds: number): string => new Date(Date.parse("2026-09-29T10:00:00.000Z") + offsetSeconds * 1000).toISOString();

/** A small, real (in-memory) persisted "world," following the `packages/practice-api/test/fixtures.ts` precedent. */
export class World {
  readonly studentAccounts = new InMemoryStudentAccountRepository();
  readonly sessions = new InMemorySessionRepository();

  service(): AuthApiService {
    const deps: AuthApiDependencies = { studentAccounts: this.studentAccounts, sessions: this.sessions };
    return new AuthApiService(deps);
  }
}
