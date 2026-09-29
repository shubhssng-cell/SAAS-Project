import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt);

const SCRYPT_KEY_LENGTH = 64;
const SALT_LENGTH_BYTES = 16;

/**
 * Password hashing via Node's built-in `scrypt` -- no bcrypt/argon2
 * dependency was added (see docs/product-roadmap/PHASE_1_PLATFORM_SHELL.md's
 * Unit 4 security decisions: scrypt is an OWASP-acceptable KDF, and this
 * repository's own convention throughout the roadmap has been to avoid a
 * new npm dependency where a built-in genuinely suffices). Encodes the
 * random per-password salt alongside the derived key in one string
 * (`scrypt:<saltHex>:<hashHex>`) so no separate salt column is ever needed.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH_BYTES);
  const derivedKey = (await scryptAsync(password, salt, SCRYPT_KEY_LENGTH)) as Buffer;
  return `scrypt:${salt.toString("hex")}:${derivedKey.toString("hex")}`;
}

/**
 * Fails closed (`false`) on any malformed `stored` value -- an unexpected
 * format is treated as "does not verify," never thrown, so a corrupted or
 * unexpected row can never accidentally grant access via an unhandled
 * exception a caller forgets to catch. Uses `timingSafeEqual` on the
 * derived key, never a plain `===` string comparison (which would leak
 * timing information about how many leading bytes matched).
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split(":");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;

  const [, saltHex, hashHex] = parts;
  if (!saltHex || !hashHex) return false;

  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(saltHex, "hex");
    expected = Buffer.from(hashHex, "hex");
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length !== SCRYPT_KEY_LENGTH) return false;

  const actual = (await scryptAsync(password, salt, SCRYPT_KEY_LENGTH)) as Buffer;
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}
