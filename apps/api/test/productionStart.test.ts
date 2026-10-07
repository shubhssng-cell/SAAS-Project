import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Phase 9 Unit 5 (D-101): the REAL entry point and the config-check CLI, run as child processes with a clean environment, must refuse
 * an unsafe production configuration before they connect or listen -- and must never print a value. (The positive path against a real
 * database is `productionStart.integration.test.ts`.)
 */
const API = join(dirname(fileURLToPath(import.meta.url)), "..");
const run = (script: string, env: Record<string, string>) =>
  spawnSync(process.execPath, ["--import", "tsx", script], { cwd: API, env: { PATH: process.env.PATH ?? "", SystemRoot: process.env.SystemRoot ?? "", ...env }, encoding: "utf-8", timeout: 60_000 });

describe("the entry point refuses an unsafe production start", () => {
  it("production with nothing configured exits non-zero before listening, naming the settings and no value", () => {
    const r = run("src/index.ts", { NODE_ENV: "production", PORT: "4999" });
    expect(r.status).not.toBe(0);
    const out = `${r.stdout}${r.stderr}`;
    expect(out).toMatch(/Refusing to start/);
    for (const name of ["IPMAT_PERSISTENCE", "IPMAT_ALLOWED_ORIGINS", "IPMAT_TRUST_PROXY", "IPMAT_ENTITLEMENTS"]) expect(out, name).toContain(name);
    expect(out).not.toMatch(/listening on/);
  });

  it("production with the in-memory wiring requested is refused (never silently serves data it will lose)", () => {
    const r = run("src/index.ts", { NODE_ENV: "production", IPMAT_PERSISTENCE: "memory", IPMAT_ALLOWED_ORIGINS: "https://app.example.test", IPMAT_TRUST_PROXY: "false", IPMAT_ENTITLEMENTS: "open", PORT: "4998" });
    expect(r.status).not.toBe(0);
    expect(`${r.stdout}${r.stderr}`).toMatch(/IPMAT_PERSISTENCE.*in-memory/);
  });

  it("a hostile environment never appears in the refusal output", () => {
    const r = run("src/index.ts", { NODE_ENV: "production", DATABASE_URL: "postgresql://admin:SUPER-SECRET-PW@evil.example/db", IPMAT_ALLOWED_ORIGINS: "http://SECRET-ORIGIN.example", ANTHROPIC_API_KEY: "sk-ant-SECRETKEY", IPMAT_AI_PROVIDER: "anthropic", PORT: "4997" });
    expect(r.status).not.toBe(0);
    const out = `${r.stdout}${r.stderr}`;
    for (const secret of ["SUPER-SECRET-PW", "SECRET-ORIGIN", "sk-ant-SECRETKEY", "evil.example"]) expect(out, secret).not.toContain(secret);
  });
});

describe("npm run check:config (the pre-deploy report)", () => {
  it("exits 1 and lists failing settings for an unsafe production environment; connects to nothing", () => {
    const r = run("src/checkConfig.ts", { NODE_ENV: "production" });
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/\[FAIL\] IPMAT_PERSISTENCE/);
    expect(r.stdout).toMatch(/result: NOT startable/);
  });

  it("exits 0 for a complete production environment and prints the warnings that remain, with no values", () => {
    const r = run("src/checkConfig.ts", { NODE_ENV: "production", IPMAT_PERSISTENCE: "prisma", DATABASE_URL: "postgresql://app_user:PLACEHOLDER-PW@db.internal.example:5432/app?sslmode=require", IPMAT_ALLOWED_ORIGINS: "https://app.example.test", IPMAT_TRUST_PROXY: "true", IPMAT_ENTITLEMENTS: "open" });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/result: startable/);
    expect(r.stdout).toMatch(/\[WARN\] .*IPMAT_AI_PROVIDER/);
    for (const secret of ["PLACEHOLDER-PW", "app_user", "db.internal.example", "app.example.test"]) expect(r.stdout, secret).not.toContain(secret);
  });

  it("exits 0 in development, reporting what would block a deployment", () => {
    const r = run("src/checkConfig.ts", {});
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/mode: development/);
    expect(r.stdout).toMatch(/would block a production start/);
  });
});

describe("the smoke CLI itself", () => {
  it("fails loudly (exit 1, named failures) against a server that is wrong, and exits 2 on bad usage", async () => {
    const { runSmoke } = await import("../src/smoke.js");
    const bad: typeof fetch = async () => new Response("Error: ECONNREFUSED at /home/app/node_modules/x.js", { status: 200 });
    const checks = await runSmoke("https://wrong.example", { fetchImpl: bad });
    const failed = checks.filter((c) => !c.ok).map((c) => c.name);
    expect(failed.length).toBeGreaterThan(8);
    expect(failed.join("|")).toMatch(/liveness|anonymous|generic 404/);
    const unreachable: typeof fetch = async () => { throw new TypeError("fetch failed"); };
    expect((await runSmoke("https://down.example", { fetchImpl: unreachable })).some((c) => !c.ok && /reachable/.test(c.name))).toBe(true);
    const usage = run("src/smoke.ts", {});
    expect(usage.status).toBe(2);
    expect(usage.stderr).toMatch(/usage:/);
  });
});
