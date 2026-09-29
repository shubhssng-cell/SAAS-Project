import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../src/password.js";

describe("hashPassword / verifyPassword", () => {
  it("verifies the correct password against its own hash", async () => {
    const hash = await hashPassword("correct-horse-battery-staple");
    expect(await verifyPassword("correct-horse-battery-staple", hash)).toBe(true);
  });

  it("rejects an incorrect password", async () => {
    const hash = await hashPassword("correct-horse-battery-staple");
    expect(await verifyPassword("wrong-password", hash)).toBe(false);
  });

  it("produces a different hash for the same password each time (random salt)", async () => {
    const hashA = await hashPassword("same-password");
    const hashB = await hashPassword("same-password");
    expect(hashA).not.toBe(hashB);
    expect(await verifyPassword("same-password", hashA)).toBe(true);
    expect(await verifyPassword("same-password", hashB)).toBe(true);
  });

  it("stores the hash in the documented scrypt:<salt>:<hash> format", async () => {
    const hash = await hashPassword("some-password");
    expect(hash).toMatch(/^scrypt:[0-9a-f]{32}:[0-9a-f]{128}$/);
  });

  it("never contains the raw password itself", async () => {
    const hash = await hashPassword("do-not-leak-me");
    expect(hash).not.toContain("do-not-leak-me");
  });

  it("fails closed (false, never throws) on a malformed stored value", async () => {
    await expect(verifyPassword("anything", "not-a-real-hash")).resolves.toBe(false);
    await expect(verifyPassword("anything", "scrypt:zz:zz")).resolves.toBe(false);
    await expect(verifyPassword("anything", "")).resolves.toBe(false);
    await expect(verifyPassword("anything", "md5:abc:def")).resolves.toBe(false);
  });
});
