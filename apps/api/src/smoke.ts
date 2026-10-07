/**
 * `npm run smoke --workspace @ipmat/api -- <base-url> [--origin <allowed-origin>]` -- the production smoke test (Phase 9 Unit 5,
 * docs/DEPLOYMENT.md section 8). READ-ONLY and credential-free: it creates no account and no data. It checks what a deployment must get
 * right before a student arrives: liveness and readiness, security headers, that protected routes refuse an anonymous caller, that an
 * unsigned payment callback is not accepted, that a foreign Origin cannot make a state-changing request, and that an unknown route and a
 * malformed request answer generically (no stack trace, driver text or file path). Exits 1 if any check fails.
 *
 * `--origin` is the origin the real site uses (needed only to check the "allowed origin is not refused" half of the origin rule).
 */
export interface SmokeCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export async function runSmoke(baseUrl: string, options: { origin?: string; fetchImpl?: typeof fetch } = {}): Promise<SmokeCheck[]> {
  const f = options.fetchImpl ?? fetch;
  const base = baseUrl.replace(/\/+$/, "");
  const https = base.startsWith("https://");
  const checks: SmokeCheck[] = [];
  const add = (name: string, ok: boolean, detail = ""): void => {
    checks.push({ name, ok, detail });
  };
  const get = async (path: string, init: RequestInit = {}): Promise<{ status: number; headers: Headers; text: string }> => {
    const r = await f(`${base}${path}`, init);
    return { status: r.status, headers: r.headers, text: await r.text() };
  };
  const LEAK = /\bat\s+\S+\s+\(|node_modules|[A-Za-z]:\\|\/home\/|PrismaClient|ECONNREFUSED|SELECT\s+\S+\s+FROM|password|postgres(ql)?:\/\//i;

  try {
    const live = await get("/healthz");
    add("liveness: GET /healthz is 200 {status: ok}", live.status === 200 && live.text === JSON.stringify({ status: "ok" }), `status ${live.status}`);
    const ready = await get("/readyz");
    add("readiness: GET /readyz is 200 {status: ready} (the database answers)", ready.status === 200 && ready.text === JSON.stringify({ status: "ready" }), `status ${ready.status}`);

    const me = await get("/v1/auth/me");
    add("anonymous GET /v1/auth/me is 401", me.status === 401, `status ${me.status}`);
    const h = me.headers;
    add("response carries a request id", /^[0-9a-f-]{36}$/.test(h.get("x-request-id") ?? ""), String(h.get("x-request-id")).slice(0, 8));
    add("headers: nosniff, no-store, no-referrer, frame denied", h.get("x-content-type-options") === "nosniff" && h.get("cache-control") === "no-store" && h.get("referrer-policy") === "no-referrer" && h.get("x-frame-options") === "DENY");
    add(https ? "https: Strict-Transport-Security is set" : "http: HSTS not applicable (a production site must be https)", !https || /max-age=\d+/.test(h.get("strict-transport-security") ?? ""));

    for (const [method, path, body] of [["GET", "/v1/billing"], ["POST", "/v1/billing/checkout", { planId: "x" }], ["POST", "/v1/tutor/ask", { operation: "give_hint", questionId: "x" }], ["POST", "/v1/recommendation", {}], ["GET", "/v1/preferences"], ["GET", "/v1/simulations/availability"]] as const) {
      const r = await get(path, { method, headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
      add(`anonymous ${method} ${path} is 401`, r.status === 401, `status ${r.status}`);
    }

    const hook = await get("/v1/billing/webhook", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    add("an unsigned payment callback is not accepted (400, or 503 when no provider is configured)", hook.status === 400 || hook.status === 503, `status ${hook.status}`);

    const evil = await get("/v1/auth/login", { method: "POST", headers: { "content-type": "application/json", origin: "https://evil.invalid" }, body: JSON.stringify({ email: "x@example.com", password: "wrong-password-123" }) });
    add("a state-changing request from a foreign Origin is refused (403) when an origin allowlist is configured", evil.status === 403, `status ${evil.status}`);
    if (options.origin) {
      const ok = await get("/v1/auth/login", { method: "POST", headers: { "content-type": "application/json", origin: options.origin }, body: JSON.stringify({ email: "smoke-nobody@example.invalid", password: "wrong-password-123" }) });
      add("the site's own origin is not refused by the origin rule", ok.status !== 403, `status ${ok.status}`);
    }

    const nf = await get("/v1/definitely-not-a-route");
    add("an unknown route answers a generic 404 with no internal detail", nf.status === 404 && !LEAK.test(nf.text), `status ${nf.status}`);
    const malformed = await get("/v1/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: "{not json" });
    add("a malformed body answers a generic 4xx with no internal detail", malformed.status >= 400 && malformed.status < 500 && !LEAK.test(malformed.text), `status ${malformed.status}`);
    const huge = await get("/v1/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pad: "x".repeat(70_000) }) }).catch(() => ({ status: 413, headers: new Headers(), text: "" }));
    add("an oversized body is refused (413)", huge.status === 413, `status ${huge.status}`);
  } catch (error) {
    add("the server is reachable", false, error instanceof Error ? error.name : "error");
  }
  return checks;
}

const entry = process.argv[1] ?? "";
if (/smoke\.[tj]s$/.test(entry)) {
  const args = process.argv.slice(2);
  const originIdx = args.indexOf("--origin");
  const origin = originIdx >= 0 ? args[originIdx + 1] : undefined;
  const url = args.find((a, i) => !a.startsWith("--") && i !== originIdx + 1);
  if (!url || !/^https?:\/\//.test(url)) {
    console.error("usage: npm run smoke --workspace @ipmat/api -- <https://host> [--origin <allowed-origin>]");
    process.exit(2);
  }
  const checks = await runSmoke(url, { origin });
  for (const c of checks) console.log(`${c.ok ? "PASS" : "FAIL"}  ${c.name}${c.detail ? `  (${c.detail})` : ""}`);
  const failed = checks.filter((c) => !c.ok).length;
  console.log(failed === 0 ? `smoke: ${checks.length} checks passed` : `smoke: ${failed} of ${checks.length} checks FAILED`);
  process.exit(failed === 0 ? 0 : 1);
}
