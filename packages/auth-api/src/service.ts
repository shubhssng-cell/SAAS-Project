import { assertValidEmail, assertValidPassword, computeSessionExpiry, generateSessionToken, hashPassword, hashSessionToken, normalizeEmail, verifyPassword } from "@ipmat/auth";
import { randomUUID } from "node:crypto";
import { toAuthApiError } from "./errors.js";
import { toStudentAccountView } from "./presentation.js";
import type { AuthApiDependencies, AuthApiSessionResult, CurrentSessionResult } from "./types.js";
import { AuthApiError } from "./types.js";
import { assertNonEmptyString } from "./validation.js";

/**
 * The application/API boundary's one entry point for authentication
 * (docs/product-roadmap/PHASE_1_PLATFORM_SHELL.md's Unit 4 architecture
 * section has the full design rationale). Every method: (1) validates its
 * own input, (2) delegates all credential/session cryptography to
 * `@ipmat/auth` (never reimplements hashing/token generation itself), (3)
 * delegates all persistence to the injected repository ports, (4) maps the
 * outcome to a student-safe view. Contains no HTTP/cookie logic of its own
 * — that is `apps/api`'s job, exactly like `PracticeApiService`/`apps/api`.
 *
 * `now` parameters throughout are a TESTING SEAM ONLY, the same convention
 * `@ipmat/practice-api`/`@ipmat/attempt` already use — defaults to the real
 * server clock when omitted. A real HTTP transport must never read `now`
 * from a client request.
 */
export class AuthApiService {
  constructor(private readonly deps: AuthApiDependencies) {}

  /** Creates a new Student account and an initial session in one call — a newly-signed-up student is immediately authenticated, never asked to separately log in right after signing up. */
  async signup(input: { email: string; password: string }, opts: { now?: string } = {}): Promise<AuthApiSessionResult> {
    assertNonEmptyString(input.email, "email");
    assertNonEmptyString(input.password, "password");
    const now = opts.now ?? new Date().toISOString();
    const email = normalizeEmail(input.email);

    try {
      assertValidEmail(email);
      assertValidPassword(input.password);

      const passwordHash = await hashPassword(input.password);
      const student = await this.deps.studentAccounts.create({ email, passwordHash, now });
      const session = await this.issueSession(student.id, now);

      return { student: toStudentAccountView(student), ...session };
    } catch (error) {
      throw toAuthApiError(error);
    }
  }

  /**
   * Verifies credentials and issues a NEW session — an existing session for
   * the same student (a different device/browser) is left active; multiple
   * concurrent sessions are allowed (a deliberate, disclosed V1 choice, see
   * the Unit 4 architecture doc). An unknown email and a wrong password
   * produce the EXACT SAME error — never distinguished — for
   * account-enumeration resistance.
   */
  async login(input: { email: string; password: string }, opts: { now?: string } = {}): Promise<AuthApiSessionResult> {
    assertNonEmptyString(input.email, "email");
    assertNonEmptyString(input.password, "password");
    const now = opts.now ?? new Date().toISOString();
    const email = normalizeEmail(input.email);

    try {
      const account = await this.deps.studentAccounts.findByEmailWithCredentials(email);
      const passwordMatches = account ? await verifyPassword(input.password, account.passwordHash) : false;
      if (!account || !passwordMatches) {
        throw new AuthApiError("invalid_credentials", "Incorrect email or password.", 401);
      }

      const session = await this.issueSession(account.id, now);
      return { student: toStudentAccountView(account), ...session };
    } catch (error) {
      if (error instanceof AuthApiError) throw error;
      throw toAuthApiError(error);
    }
  }

  /**
   * Verifies a session token and returns the authenticated student — the
   * ONE legitimate way anything in this system ever derives a real,
   * verified `studentId` from a request. A missing, malformed, expired, or
   * revoked token all produce the SAME `not_authenticated` error — the
   * caller can never tell which actually happened (fail-closed, no
   * internal-state leak).
   */
  async getCurrentSession(input: { sessionToken: string }, opts: { now?: string } = {}): Promise<CurrentSessionResult> {
    assertNonEmptyString(input.sessionToken, "sessionToken");
    const now = opts.now ?? new Date().toISOString();

    try {
      const student = await this.resolveAuthenticatedStudent(input.sessionToken, now);
      return { student: toStudentAccountView(student) };
    } catch (error) {
      if (error instanceof AuthApiError) throw error;
      throw toAuthApiError(error);
    }
  }

  /**
   * Marks the CALLING student's onboarding as complete (Product Phase 1
   * Unit 6) — the student is derived EXCLUSIVELY from the verified session
   * token via the same `resolveAuthenticatedStudent()` every other
   * identity-requiring method uses; there is no parameter through which a
   * caller could supply a different `studentId` directly. Idempotent —
   * `StudentAccountRepository.completeOnboarding()` never moves an
   * already-set completion timestamp forward, so calling this twice (a
   * double-click, a retried request) is always safe.
   */
  async completeOnboarding(input: { sessionToken: string }, opts: { now?: string } = {}): Promise<CurrentSessionResult> {
    assertNonEmptyString(input.sessionToken, "sessionToken");
    const now = opts.now ?? new Date().toISOString();

    try {
      const student = await this.resolveAuthenticatedStudent(input.sessionToken, now);
      const updated = await this.deps.studentAccounts.completeOnboarding(student.id, now);
      return { student: toStudentAccountView(updated) };
    } catch (error) {
      if (error instanceof AuthApiError) throw error;
      throw toAuthApiError(error);
    }
  }

  /**
   * Revokes the session matching this token. Logging out an already-
   * invalid/expired/unknown token is a NO-OP SUCCESS, never an error --
   * there is nothing meaningfully wrong about asking to end a session that
   * is already effectively ended.
   */
  async logout(input: { sessionToken: string }, opts: { now?: string } = {}): Promise<void> {
    assertNonEmptyString(input.sessionToken, "sessionToken");
    const now = opts.now ?? new Date().toISOString();

    try {
      const tokenHash = hashSessionToken(input.sessionToken);
      const session = await this.deps.sessions.findActiveByTokenHash(tokenHash, now);
      if (session) {
        await this.deps.sessions.revoke(session.id, now);
      }
    } catch (error) {
      throw toAuthApiError(error);
    }
  }

  /**
   * The ONE place a raw session token is turned into a verified student
   * row — every method that needs the calling student's real identity
   * (`getCurrentSession()`, `completeOnboarding()`, and any future
   * session-authenticated method) goes through this, never re-implements
   * the lookup. Throws `AuthApiError("not_authenticated", ...)` for a
   * missing/expired/revoked token; throws `infrastructure_failure` if the
   * session is valid but its `Student` row is inexplicably gone (a real
   * infrastructure inconsistency, never silently treated as "not logged in").
   */
  private async resolveAuthenticatedStudent(sessionToken: string, now: string) {
    const tokenHash = hashSessionToken(sessionToken);
    const session = await this.deps.sessions.findActiveByTokenHash(tokenHash, now);
    if (!session) {
      throw new AuthApiError("not_authenticated", "Your session has expired or is no longer valid. Please log in again.", 401);
    }

    const student = await this.deps.studentAccounts.findById(session.studentId);
    if (!student) {
      throw new AuthApiError("infrastructure_failure", "Your account could not be loaded right now. Please try again.", 500);
    }
    return student;
  }

  private async issueSession(studentId: string, now: string): Promise<{ sessionToken: string; expiresAt: string }> {
    const sessionToken = generateSessionToken();
    const tokenHash = hashSessionToken(sessionToken);
    const expiresAt = computeSessionExpiry(new Date(now)).toISOString();
    await this.deps.sessions.create({ id: randomUUID(), studentId, tokenHash, now, expiresAt });
    return { sessionToken, expiresAt };
  }
}
