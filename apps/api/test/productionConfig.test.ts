import { describe, expect, it } from "vitest";
import { assertProductionConfig, evaluateProductionConfig, formatReport } from "../src/productionConfig.js";

/** Phase 9 Unit 5 (D-101): the production configuration boundary. Every value here is a synthetic placeholder. */
const GOOD: Record<string, string> = {
  NODE_ENV: "production",
  IPMAT_PERSISTENCE: "prisma",
  DATABASE_URL: "postgresql://app_user:PLACEHOLDER-PW@db.internal.example:5432/app?sslmode=require",
  IPMAT_ALLOWED_ORIGINS: "https://app.example.test",
  IPMAT_TRUST_PROXY: "true",
  IPMAT_ENTITLEMENTS: "open"
};
const CATALOG = JSON.stringify({ baseline: { exams: ["EXAM_A"], features: [], usageLimits: [] }, plans: [] });
const statusOf = (env: Record<string, string>, name: string): string | undefined => evaluateProductionConfig(env).checks.find((c) => c.name.startsWith(name))?.status;
const failing = (env: Record<string, string | undefined>): string[] => evaluateProductionConfig(env as Record<string, string>).checks.filter((c) => c.status === "fail").map((c) => c.name);

describe("production configuration", () => {
  it("a complete production environment is startable (warnings allowed), and says what is still open", () => {
    const report = assertProductionConfig(GOOD);
    expect(report.ok).toBe(true);
    const warns = report.checks.filter((c) => c.status === "warn").map((c) => c.name + ": " + c.detail).join("\n");
    expect(warns).toMatch(/entitlements are OPEN/);
    expect(warns).toMatch(/no AI provider/);
  });

  const refusals: Array<[string, Record<string, string | undefined>, string]> = [
    ["durable storage is mandatory (in-memory is refused)", { ...GOOD, IPMAT_PERSISTENCE: undefined }, "IPMAT_PERSISTENCE"],
    ["an explicit in-memory request is refused too", { ...GOOD, IPMAT_PERSISTENCE: "memory" }, "IPMAT_PERSISTENCE"],
    ["prisma without a DATABASE_URL is refused", { ...GOOD, DATABASE_URL: undefined }, "IPMAT_PERSISTENCE"],
    ["a non-postgres DATABASE_URL is refused", { ...GOOD, DATABASE_URL: "mysql://u:p@h/db" }, "DATABASE_URL"],
    ["a malformed DATABASE_URL is refused", { ...GOOD, DATABASE_URL: "not a url" }, "DATABASE_URL"],
    ["origins are required", { ...GOOD, IPMAT_ALLOWED_ORIGINS: undefined }, "IPMAT_ALLOWED_ORIGINS"],
    ["origins must be https in production", { ...GOOD, IPMAT_ALLOWED_ORIGINS: "http://app.example.test" }, "IPMAT_ALLOWED_ORIGINS"],
    ["a wildcard origin is refused", { ...GOOD, IPMAT_ALLOWED_ORIGINS: "https://*.example.test" }, "IPMAT_ALLOWED_ORIGINS"],
    ["an origin with a path is refused", { ...GOOD, IPMAT_ALLOWED_ORIGINS: "https://app.example.test/app" }, "IPMAT_ALLOWED_ORIGINS"],
    ["the proxy decision must be explicit", { ...GOOD, IPMAT_TRUST_PROXY: undefined }, "IPMAT_TRUST_PROXY"],
    ["the proxy decision must be true or false", { ...GOOD, IPMAT_TRUST_PROXY: "yes" }, "IPMAT_TRUST_PROXY"],
    ["entitlements must be chosen explicitly", { ...GOOD, IPMAT_ENTITLEMENTS: undefined }, "IPMAT_ENTITLEMENTS"],
    ["enforced entitlements need a catalog", { ...GOOD, IPMAT_ENTITLEMENTS: "enforced" }, "IPMAT_ENTITLEMENTS"],
    ["a malformed catalog is refused", { ...GOOD, IPMAT_ENTITLEMENTS: "enforced", IPMAT_BILLING_CATALOG: "{nope" }, "IPMAT_ENTITLEMENTS"],
    ["a payment provider with no adapter is refused", { ...GOOD, IPMAT_PAYMENT_PROVIDER: "stripe" }, "IPMAT_ENTITLEMENTS"],
    ["the dev-scripted AI scaffold is refused in production", { ...GOOD, IPMAT_AI_PROVIDER: "dev-scripted" }, "IPMAT_AI_PROVIDER"],
    ["anthropic needs a key", { ...GOOD, IPMAT_AI_PROVIDER: "anthropic", IPMAT_AI_MODEL: "m", IPMAT_HYPOTHESIS_SECRET: "x".repeat(40) }, "IPMAT_AI_PROVIDER"],
    ["anthropic needs a model", { ...GOOD, IPMAT_AI_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "placeholder", IPMAT_HYPOTHESIS_SECRET: "x".repeat(40) }, "IPMAT_AI_PROVIDER"],
    ["a model with no shared hypothesis secret is refused", { ...GOOD, IPMAT_AI_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "placeholder", IPMAT_AI_MODEL: "m" }, "IPMAT_HYPOTHESIS_SECRET"],
    ["a short hypothesis secret is refused", { ...GOOD, IPMAT_AI_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "placeholder", IPMAT_AI_MODEL: "m", IPMAT_HYPOTHESIS_SECRET: "short" }, "IPMAT_HYPOTHESIS_SECRET"],
    ["a bad log level is refused", { ...GOOD, IPMAT_LOG_LEVEL: "chatty" }, "IPMAT_LOG_LEVEL"],
    ["a bad port is refused", { ...GOOD, PORT: "99999" }, "PORT"]
  ];
  for (const [label, env, name] of refusals) {
    it(`refuses startup: ${label}`, () => {
      expect(failing(env).some((n) => n.startsWith(name)), name).toBe(true);
      expect(() => assertProductionConfig(env as Record<string, string>)).toThrow(/Refusing to start/);
    });
  }

  it("accepts a fully configured model (key, model, shared secret) without echoing any of them", () => {
    const env = { ...GOOD, IPMAT_AI_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "PLACEHOLDER-KEY-VALUE-123", IPMAT_AI_MODEL: "placeholder-model", IPMAT_HYPOTHESIS_SECRET: "S".repeat(40) };
    const report = assertProductionConfig(env);
    expect(report.ok).toBe(true);
    const text = formatReport(report);
    for (const secret of ["PLACEHOLDER-KEY-VALUE-123", "S".repeat(40), "PLACEHOLDER-PW", "app_user", "db.internal.example", "placeholder-model"]) expect(text, secret).not.toContain(secret);
    expect(text).toContain("anthropic (key and model present)");
  });

  it("an enforced catalog with no provider is startable but flagged: checkout is unavailable", () => {
    const report = assertProductionConfig({ ...GOOD, IPMAT_ENTITLEMENTS: "enforced", IPMAT_BILLING_CATALOG: CATALOG });
    expect(report.ok).toBe(true);
    expect(report.checks.find((c) => c.name.startsWith("IPMAT_ENTITLEMENTS"))?.detail).toMatch(/no payment provider is configured/);
  });

  it("a remote database without TLS requested is a warning; a local one is flagged too", () => {
    expect(evaluateProductionConfig({ ...GOOD, DATABASE_URL: "postgresql://u:p@db.example.test/app" }).checks.find((c) => c.name === "DATABASE_URL")?.status).toBe("warn");
    expect(evaluateProductionConfig({ ...GOOD, DATABASE_URL: "postgresql://u:p@127.0.0.1:55432/app" }).checks.find((c) => c.name === "DATABASE_URL")?.status).toBe("warn");
    expect(statusOf(GOOD, "DATABASE_URL")).toBe("ok");
  });

  it("outside production the same findings are advisory: nothing blocks a developer, and the report says what WOULD block a deployment", () => {
    const report = assertProductionConfig({});
    expect(report.production).toBe(false);
    expect(report.ok).toBe(true);
    expect(report.checks.every((c) => c.status !== "fail")).toBe(true);
    expect(report.checks.find((c) => c.name === "IPMAT_PERSISTENCE")?.detail).toMatch(/would block a production start/);
    expect(formatReport(report)).toMatch(/mode: development/);
  });

  it("never echoes a value: the report of a hostile environment contains only names and fixed text", () => {
    const env = { ...GOOD, DATABASE_URL: "postgresql://admin:SUPER-SECRET-PW@evil.example/db", IPMAT_ALLOWED_ORIGINS: "https://a.test,http://SECRET-ORIGIN.example", ANTHROPIC_API_KEY: "sk-ant-SECRETKEY", IPMAT_AI_PROVIDER: "weird-SECRET", IPMAT_BILLING_CATALOG: "SECRET-CATALOG-TEXT", IPMAT_ENTITLEMENTS: "enforced" };
    const text = formatReport(evaluateProductionConfig(env));
    for (const secret of ["SUPER-SECRET-PW", "SECRET-ORIGIN", "sk-ant-SECRETKEY", "weird-SECRET", "SECRET-CATALOG-TEXT", "admin", "evil.example"]) expect(text, secret).not.toContain(secret);
    expect(text).toMatch(/NOT startable/);
  });
});

describe("a configured payment provider needs its return URL", () => {
  const adapters = { "test-provider": () => ({ name: "test-provider" }) as never };
  const withProvider = { ...GOOD, IPMAT_ENTITLEMENTS: "enforced", IPMAT_BILLING_CATALOG: CATALOG, IPMAT_PAYMENT_PROVIDER: "test-provider" };

  it("is refused without IPMAT_CHECKOUT_RETURN_URL, and startable with one", () => {
    expect(evaluateProductionConfig(withProvider, adapters).checks.some((c) => c.status === "fail" && /IPMAT_CHECKOUT_RETURN_URL/.test(c.detail))).toBe(true);
    const ok = evaluateProductionConfig({ ...withProvider, IPMAT_CHECKOUT_RETURN_URL: "https://app.example.test/billing?checkout=return" }, adapters);
    expect(ok.ok).toBe(true);
    expect(ok.checks.find((c) => c.name.startsWith("IPMAT_ENTITLEMENTS"))?.detail).toBe("enforced, provider configured");
  });
});
