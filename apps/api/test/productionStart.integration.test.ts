import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPrismaClient } from "@ipmat/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { runSmoke } from "../src/smoke.js";
import { createIsolatedDatabase } from "./isolatedDatabase.js";

/**
 * Phase 9 Unit 5 (D-101): PRODUCTION START / SMOKE TEST. Starts the real entry point (`src/index.ts`) as a child process with
 * NODE_ENV=production against a real, freshly migrated Postgres, and checks what an operator and a first student would see.
 * SKIPPED unless `IPMAT_TEST_DATABASE_URL` is set (and refuses a database whose name lacks "test"). The AI provider and the payment
 * provider are NOT configured (none exists here), so this proves the product starts and serves honestly without them.
 */
const DATABASE_URL = process.env.IPMAT_TEST_DATABASE_URL;
if (DATABASE_URL) {
  const dbName = new URL(DATABASE_URL).pathname.replace(/^\//, "");
  if (!/test/i.test(dbName)) throw new Error(`Refusing to run integration tests against database "${dbName}": IPMAT_TEST_DATABASE_URL must point at a database whose name contains "test".`);
}
vi.setConfig({ testTimeout: 120_000 });

const API = join(dirname(fileURLToPath(import.meta.url)), "..");
const freePort = (): Promise<number> => new Promise((resolve, reject) => { const s = createServer(); s.listen(0, "127.0.0.1", () => { const p = (s.address() as { port: number }).port; s.close(() => resolve(p)); }); s.on("error", reject); });
const ORIGIN = "https://app.example.test";

function start(env: Record<string, string>): { child: ChildProcess; output: () => string } {
  let buf = "";
  const child = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], { cwd: API, env: { PATH: process.env.PATH ?? "", SystemRoot: process.env.SystemRoot ?? "", ...env }, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout?.on("data", (d: Buffer) => { buf += d.toString(); });
  child.stderr?.on("data", (d: Buffer) => { buf += d.toString(); });
  return { child, output: () => buf };
}
const stop = (child: ChildProcess): Promise<void> => new Promise((resolve) => { if (child.exitCode !== null) return resolve(); child.once("exit", () => resolve()); child.kill(); setTimeout(() => { child.kill("SIGKILL"); resolve(); }, 8000).unref(); });
const exited = (child: ChildProcess): Promise<number | null> => new Promise((resolve) => { if (child.exitCode !== null) return resolve(child.exitCode); child.once("exit", (c) => resolve(c)); });

describe.skipIf(!DATABASE_URL)("production start / smoke - real entry point, real Postgres", () => {
  let db: { url: string; drop: () => Promise<void> };
  let emptyUrl = "";
  let port = 0;
  let base = "";
  let proc: ReturnType<typeof start>;
  const dropEmpty: Array<() => Promise<void>> = [];

  const prodEnv = (databaseUrl: string, p: number, extra: Record<string, string> = {}): Record<string, string> => ({
    NODE_ENV: "production",
    IPMAT_PERSISTENCE: "prisma",
    DATABASE_URL: databaseUrl,
    IPMAT_ALLOWED_ORIGINS: ORIGIN,
    IPMAT_TRUST_PROXY: "false",
    IPMAT_ENTITLEMENTS: "open",
    IPMAT_LOG_LEVEL: "info",
    PORT: String(p),
    ...extra
  });

  async function waitUp(url: string): Promise<void> {
    await vi.waitFor(async () => { const r = await fetch(`${url}/healthz`); expect(r.status).toBe(200); }, { timeout: 60_000, interval: 300 });
  }

  beforeAll(async () => {
    db = await createIsolatedDatabase(DATABASE_URL!, "p9u5start");
    // an EMPTY database (never migrated) for the refusal test
    const admin = createPrismaClient(DATABASE_URL!);
    await admin.$connect();
    const name = `${new URL(DATABASE_URL!).pathname.replace(/^\//, "")}_empty_${randomUUID().slice(0, 8)}`;
    await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
    await admin.$disconnect();
    const u = new URL(DATABASE_URL!);
    u.pathname = `/${name}`;
    emptyUrl = u.toString();
    dropEmpty.push(async () => { const d = createPrismaClient(DATABASE_URL!); await d.$connect(); await d.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`); await d.$disconnect(); });

    port = await freePort();
    base = `http://127.0.0.1:${port}`;
    proc = start(prodEnv(db.url, port));
    await waitUp(base);
  }, 180_000);

  afterAll(async () => {
    if (proc) await stop(proc.child);
    await db?.drop();
    for (const d of dropEmpty) await d();
  }, 60_000);

  it("starts in production mode, prints the (value-free) configuration report, and says what it is not serving", () => {
    const out = proc.output();
    expect(out).toMatch(/mode: production/);
    expect(out).toMatch(/result: startable/);
    expect(out).toMatch(/listening on/);
    expect(out).toMatch(/Prisma repositories; database connected/);
    for (const secret of ["postgresql://", db.url, ORIGIN]) expect(out, secret).not.toContain(secret);
  });

  it("liveness and readiness are generic and the readiness reflects the real database", async () => {
    expect(await fetch(`${base}/healthz`).then(async (r) => [r.status, await r.json()])).toEqual([200, { status: "ok" }]);
    expect(await fetch(`${base}/readyz`).then(async (r) => [r.status, await r.json()])).toEqual([200, { status: "ready" }]);
  });

  it("serves production security headers, including HSTS, on every response", async () => {
    const r = await fetch(`${base}/v1/auth/me`);
    expect(r.status).toBe(401);
    expect(r.headers.get("strict-transport-security")).toMatch(/max-age=\d+/);
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(r.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("enforces the origin allowlist on state-changing requests and sets a Secure, HttpOnly session cookie for the allowed origin", async () => {
    const body = JSON.stringify({ email: `p9u5-${randomUUID()}@example.com`, password: "correct-horse-battery-1" });
    const evil = await fetch(`${base}/v1/auth/signup`, { method: "POST", headers: { "content-type": "application/json", origin: "https://evil.example" }, body });
    expect(evil.status).toBe(403);
    const ok = await fetch(`${base}/v1/auth/signup`, { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN }, body });
    expect(ok.status).toBe(200);
    const cookie = ok.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/Secure/);
    expect(cookie).toMatch(/SameSite=Lax/);
  });

  it("a new student's first journey works on the production entry point: enroll, practice, and honest 'not available' states", async () => {
    const body = (extra: object = {}) => JSON.stringify({ email: `p9u5-${randomUUID()}@example.com`, password: "correct-horse-battery-1", ...extra });
    const signup = await fetch(`${base}/v1/auth/signup`, { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN }, body: body() });
    const cookie = (signup.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
    const j = (method: string, path: string, payload?: unknown) => fetch(`${base}${path}`, { method, headers: { cookie, origin: ORIGIN, ...(payload !== undefined ? { "content-type": "application/json" } : {}) }, body: payload !== undefined ? JSON.stringify(payload) : undefined });
    expect((await j("POST", "/v1/onboarding/complete")).status).toBe(200);
    expect((await j("POST", "/v1/enrollment")).status).toBe(200);
    expect((await j("POST", "/v1/recommendation", {})).status).toBe(200);
    // no AI provider is configured: the tutor says so instead of pretending
    const tutor = await j("POST", "/v1/tutor/ask", { operation: "give_hint", questionId: "x" });
    expect([503, 400, 404]).toContain(tutor.status);
    // no simulation configuration exists: availability says false, a start is an honest 503
    expect(await (await j("GET", "/v1/simulations/availability")).json()).toEqual({ available: false });
    expect((await j("POST", "/v1/simulations")).status).toBe(503);
    // open entitlements: the billing summary says so; no payment provider: checkout is unavailable
    const billing = (await (await j("GET", "/v1/billing")).json()) as { enforcement: string; checkoutAvailable: boolean };
    expect(billing).toMatchObject({ enforcement: "open", checkoutAvailable: false });
    expect((await j("POST", "/v1/billing/checkout", { planId: "anything" })).status).toBe(400); // no plan exists to buy: refused before any provider is considered
  });

  it("the shipped smoke-test CLI passes against the running production entry point (read-only, no credentials)", async () => {
    const checks = await runSmoke(base, { origin: ORIGIN });
    expect(checks.filter((c) => !c.ok)).toEqual([]);
    expect(checks.length).toBeGreaterThanOrEqual(18);
  });

  it("the payment webhook is honestly unavailable (no provider), and accepts nothing", async () => {
    const r = await fetch(`${base}/v1/billing/webhook`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(r.status).toBe(503);
  });

  it("refuses to start against a database that has never been migrated, naming the fix and no connection detail", async () => {
    const p = await freePort();
    const bad = start(prodEnv(emptyUrl, p));
    const code = await exited(bad.child);
    expect(code).not.toBe(0);
    const out = bad.output();
    expect(out).toMatch(/no migration history|no applied migrations/);
    expect(out).toMatch(/migrate deploy/);
    expect(out).not.toMatch(/listening on/);
    expect(out).not.toContain(emptyUrl);
  });
});
