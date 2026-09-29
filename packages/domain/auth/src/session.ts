import { createHash, randomBytes } from "node:crypto";

const SESSION_TOKEN_LENGTH_BYTES = 32;

/**
 * PROVISIONAL -- not calibrated against real usage data, the same
 * "provisional until real data exists" discipline this codebase already
 * applies to `@ipmat/mastery`'s `MASTERY_CONSTANTS` and `@ipmat/autopsy`'s
 * `AUTOPSY_THRESHOLDS`. An absolute expiry (no idle/sliding window) -- a
 * deliberate V1 simplification, not an oversight.
 */
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 14; // 14 days

/** A cryptographically random, opaque bearer token (256 bits) -- never a JWT, never carries any claim of its own. See the Unit 4 architecture doc for why. */
export function generateSessionToken(): string {
  return randomBytes(SESSION_TOKEN_LENGTH_BYTES).toString("hex");
}

/**
 * The raw token is NEVER persisted -- only this SHA-256 digest is, so a
 * database read (backup leak, misconfigured replica, etc.) can never be
 * replayed as a live session, mirroring password hashing's own "store a
 * verifier, never the secret" principle. A fast digest (not scrypt) is
 * deliberate: the token already carries 256 bits of real entropy (unlike a
 * human-chosen password), so a slow KDF buys nothing here and would only
 * slow down every authenticated request.
 */
export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function computeSessionExpiry(now: Date, ttlSeconds: number = SESSION_TTL_SECONDS): Date {
  return new Date(now.getTime() + ttlSeconds * 1000);
}
