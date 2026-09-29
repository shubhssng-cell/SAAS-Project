import { describe, expect, it } from "vitest";
import { computeSessionExpiry, generateSessionToken, hashSessionToken, SESSION_TTL_SECONDS } from "../src/session.js";

describe("generateSessionToken", () => {
  it("produces a 64-character hex string (256 bits of entropy)", () => {
    const token = generateSessionToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  it("never repeats across many calls", () => {
    const tokens = new Set(Array.from({ length: 1000 }, () => generateSessionToken()));
    expect(tokens.size).toBe(1000);
  });
});

describe("hashSessionToken", () => {
  it("is deterministic -- the same token always hashes the same way", () => {
    const token = generateSessionToken();
    expect(hashSessionToken(token)).toBe(hashSessionToken(token));
  });

  it("produces different hashes for different tokens", () => {
    const a = generateSessionToken();
    const b = generateSessionToken();
    expect(hashSessionToken(a)).not.toBe(hashSessionToken(b));
  });

  it("never contains the raw token itself", () => {
    const token = generateSessionToken();
    const hash = hashSessionToken(token);
    expect(hash).not.toBe(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("computeSessionExpiry", () => {
  it("adds SESSION_TTL_SECONDS by default", () => {
    const now = new Date("2026-09-29T00:00:00.000Z");
    const expiry = computeSessionExpiry(now);
    expect(expiry.getTime() - now.getTime()).toBe(SESSION_TTL_SECONDS * 1000);
  });

  it("honors an explicit ttlSeconds override", () => {
    const now = new Date("2026-09-29T00:00:00.000Z");
    const expiry = computeSessionExpiry(now, 60);
    expect(expiry.getTime() - now.getTime()).toBe(60 * 1000);
  });
});
