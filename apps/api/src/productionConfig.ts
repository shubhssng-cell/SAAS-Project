import { resolveAiConfig } from "./hypothesisWiring.js";
import { resolveCommerceConfig, type PaymentProviderFactory } from "./commerceWiring.js";
import { resolvePersistenceMode } from "./persistence.js";

/**
 * The production configuration boundary (Phase 9 Unit 5, docs/DECISIONS.md D-101).
 *
 * `evaluateProductionConfig` inspects the environment and reports, per setting, whether it is acceptable. In production
 * (`NODE_ENV=production`) every `fail` refuses startup (`assertProductionConfig`); outside production the same findings are
 * warnings, so a developer sees what would block a deployment without being blocked. The report carries only setting NAMES and
 * fixed explanations: it never echoes a value, so it cannot leak a credential, a connection string or a secret.
 *
 * What it adds on top of the per-feature resolvers (`resolvePersistenceMode`, `resolveAiConfig`, `resolveCommerceConfig`,
 * `buildProductionRuntime`, which keep their own fail-closed rules): the cross-cutting production requirements that none of them
 * can know alone - durable storage is mandatory, the proxy trust decision must be explicit, a shared hypothesis secret is needed when
 * a model is enabled, and origins must be https.
 */
export type CheckStatus = "ok" | "warn" | "fail";
export interface ConfigCheck {
  /** The setting (or concern) this finding is about. A name, never a value. */
  name: string;
  status: CheckStatus;
  detail: string;
}
export interface ProductionReport {
  production: boolean;
  checks: ConfigCheck[];
  /** True when nothing failed (warnings are allowed). */
  ok: boolean;
}

const MIN_SECRET_LENGTH = 32;

function guard(name: string, fn: () => ConfigCheck["detail"] | { warn: string }): ConfigCheck {
  try {
    const result = fn();
    return typeof result === "string" ? { name, status: "ok", detail: result } : { name, status: "warn", detail: result.warn };
  } catch (error) {
    // The resolvers' own messages name settings and rules, not values; they are safe to show.
    return { name, status: "fail", detail: error instanceof Error ? error.message : "invalid" };
  }
}

export function evaluateProductionConfig(env: Record<string, string | undefined>, adapters?: Readonly<Record<string, PaymentProviderFactory>>): ProductionReport {
  const production = (env.NODE_ENV ?? "").toLowerCase() === "production";
  const checks: ConfigCheck[] = [];
  const push = (c: ConfigCheck): void => {
    // Outside production a failure is advisory.
    checks.push(production || c.status !== "fail" ? c : { ...c, status: "warn", detail: `would block a production start: ${c.detail}` });
  };

  push(guard("NODE_ENV", () => (production ? "production" : { warn: "not production: development defaults apply" })));

  // Durable storage is mandatory in production: an in-memory server that believes it is serving students is worse than no server.
  push(
    guard("IPMAT_PERSISTENCE", () => {
      const mode = resolvePersistenceMode(env);
      if (mode.kind !== "prisma") throw new Error("production requires IPMAT_PERSISTENCE=prisma (the in-memory wiring loses every student's data on restart)");
      return "prisma (DATABASE_URL present)";
    })
  );
  if (env.DATABASE_URL?.trim()) {
    push(
      guard("DATABASE_URL", () => {
        let url: URL;
        try {
          url = new URL(env.DATABASE_URL!);
        } catch {
          throw new Error("DATABASE_URL is not a valid connection URL");
        }
        if (!/^postgres(ql)?:$/.test(url.protocol)) throw new Error("DATABASE_URL must be a postgres:// URL");
        if (["localhost", "127.0.0.1", "::1"].includes(url.hostname)) return { warn: "the database host is local; confirm this is intended for this deployment" };
        const ssl = (url.searchParams.get("sslmode") ?? "").toLowerCase();
        return ["require", "verify-ca", "verify-full"].includes(ssl) ? "remote host, TLS requested" : { warn: "no sslmode=require/verify-* on a remote database URL; confirm transport encryption is provided by the platform" };
      })
    );
  }

  push(
    guard("IPMAT_ALLOWED_ORIGINS", () => {
      const origins = (env.IPMAT_ALLOWED_ORIGINS ?? "").split(",").map((o) => o.trim()).filter(Boolean);
      if (origins.length === 0) throw new Error("production requires IPMAT_ALLOWED_ORIGINS (the browser origins allowed to make state-changing requests)");
      for (const o of origins) {
        if (!/^https?:\/\/[A-Za-z0-9.-]+(:\d{1,5})?$/.test(o)) throw new Error("IPMAT_ALLOWED_ORIGINS must list bare origins (no path, no wildcard)");
        if (!o.startsWith("https://")) throw new Error("production origins must be https");
      }
      return `${origins.length} https origin(s)`;
    })
  );

  push(
    guard("IPMAT_TRUST_PROXY", () => {
      const v = (env.IPMAT_TRUST_PROXY ?? "").trim().toLowerCase();
      if (v !== "true" && v !== "false") throw new Error("production requires an explicit IPMAT_TRUST_PROXY=true|false (behind a proxy, \"false\" makes every client share the proxy's address for rate limiting; \"true\" without a proxy lets clients forge theirs)");
      return v === "true" ? "true (X-Forwarded-For last hop is trusted: a proxy MUST overwrite it)" : "false (the socket address is used)";
    })
  );

  push(
    guard("IPMAT_ENTITLEMENTS / IPMAT_BILLING_CATALOG / IPMAT_PAYMENT_PROVIDER / IPMAT_CHECKOUT_RETURN_URL", () => {
      const c = resolveCommerceConfig(env, adapters);
      if (c.mode === "open") return { warn: "entitlements are OPEN: every enrolled student can use every feature (no paywall, no metering)" };
      if (!c.provider) return { warn: "entitlements are enforced but no payment provider is configured: checkout is unavailable, only the baseline applies" };
      if (!c.returnUrl) throw new Error("a payment provider is configured but IPMAT_CHECKOUT_RETURN_URL is not");
      return "enforced, provider configured";
    })
  );

  const ai = guard("IPMAT_AI_PROVIDER", () => {
    const c = resolveAiConfig(env);
    if (c.kind === "none") return { warn: "no AI provider: the tutor and hypothesis generation answer \"not available\"" };
    return `${c.kind}${c.kind === "anthropic" ? " (key and model present)" : ""}`;
  });
  push(ai);
  if (ai.status === "ok") {
    push(
      guard("IPMAT_HYPOTHESIS_SECRET", () => {
        const secret = env.IPMAT_HYPOTHESIS_SECRET ?? "";
        if (secret.length < MIN_SECRET_LENGTH) throw new Error(`a model is enabled, so production requires IPMAT_HYPOTHESIS_SECRET of at least ${MIN_SECRET_LENGTH} characters shared by every instance (a per-process random secret breaks confirmation tokens across instances and restarts)`);
        return "set (length ok)";
      })
    );
  }

  push(
    guard("IPMAT_LOG_LEVEL", () => {
      const level = (env.IPMAT_LOG_LEVEL ?? "info").toLowerCase();
      if (!["debug", "info", "warn", "error"].includes(level)) throw new Error("IPMAT_LOG_LEVEL must be debug|info|warn|error");
      return level === "debug" ? { warn: "debug logging is verbose; use info in production" } : level;
    })
  );
  push(
    guard("PORT", () => {
      const raw = env.PORT ?? "4001";
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 1 || n > 65535) throw new Error("PORT must be a port number");
      return "valid";
    })
  );

  return { production, checks, ok: checks.every((c) => c.status !== "fail") };
}

/** Throws one error naming every failing setting (never a value). Only meaningful in production; elsewhere `fail` was already downgraded to a warning. */
export function assertProductionConfig(env: Record<string, string | undefined>, adapters?: Readonly<Record<string, PaymentProviderFactory>>): ProductionReport {
  const report = evaluateProductionConfig(env, adapters);
  const failing = report.checks.filter((c) => c.status === "fail");
  if (failing.length > 0) throw new Error(`Refusing to start: ${failing.map((c) => `${c.name}: ${c.detail}`).join(" | ")}`);
  return report;
}

/** One printable line per check: `[ok|WARN|FAIL] name - detail`. */
export function formatReport(report: ProductionReport): string {
  const tag: Record<CheckStatus, string> = { ok: "ok  ", warn: "WARN", fail: "FAIL" };
  return [`mode: ${report.production ? "production" : "development"}`, ...report.checks.map((c) => `[${tag[c.status]}] ${c.name} - ${c.detail}`), report.ok ? "result: startable" : "result: NOT startable"].join("\n");
}
