import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { LATENCY_BUCKETS_MS, LOG_FIELDS, createConcurrencyGate, createLogger, createMetrics, createRateLimiter, currentContext, newRequestId, runWithContext, sanitizeValue, studentRef, timed, updateContext, type RequestContext } from "../src/index.js";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

function capture(options: Parameters<typeof createLogger>[0] = {}) {
  const lines: string[] = [];
  const logger = createLogger({ sink: (l) => lines.push(l), now: () => new Date("2026-10-07T10:00:00.000Z"), ...options });
  return { lines, logger, records: () => lines.map((l) => JSON.parse(l) as Record<string, unknown>) };
}

describe("package boundary", () => {
  it("has no dependencies, no network, no environment reads and no vendor imports", () => {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf-8")) as { dependencies?: object };
    expect(pkg.dependencies ?? {}).toEqual({});
    for (const file of readdirSync(join(root, "src"))) {
      const text = readFileSync(join(root, "src", file), "utf-8");
      expect(text, file).not.toMatch(/process\.env|fetch\(|node:http|node:net|@ipmat\/|@anthropic|openai/);
    }
  });
});

describe("logger: allowlist, redaction, truncation", () => {
  it("emits one JSON line with a timestamp, level, event and only allowlisted fields", () => {
    const { logger, records } = capture();
    logger.info("http.request", { method: "GET", route: "GET /v1/x", status: 200, latencyMs: 12 });
    expect(records()).toEqual([{ ts: "2026-10-07T10:00:00.000Z", level: "info", event: "http.request", method: "GET", route: "GET /v1/x", status: 200, latencyMs: 12 }]);
  });

  it("DROPS any field that is not on the allowlist and reports how many (a prompt, answer, key or text cannot be logged by passing it in)", () => {
    const { logger, records } = capture();
    logger.info("tutor.completed", { operation: "give_hint", prompt: "SECRET PROMPT", response: "SECRET MODEL TEXT", answerKey: "42", password: "hunter2", focus: "student words", cookie: "session_token=abc" } as never);
    const [r] = records();
    expect(r).toMatchObject({ event: "tutor.completed", operation: "give_hint", droppedFields: 6 });
    expect(JSON.stringify(r)).not.toMatch(/SECRET|hunter2|student words|answerKey|42"/);
  });

  it("drops object and array values even under an allowed name, so structured data cannot ride along", () => {
    const { logger, records } = capture();
    logger.info("x.y", { operation: { nested: "SECRET" } as never, check: ["SECRET"] as never });
    expect(JSON.stringify(records())).not.toContain("SECRET");
  });

  it.each([
    // the key is assembled at run time so that no credential-shaped literal exists in the source
    ["an API key", ["sk", "ant", "api03", "ABCDEFGH12345678"].join("-")],
    ["a bearer token", "Bearer abcdefghijklmnop.qrstuvwxyz"],
    ["a database URL", "postgresql://user:pw@host:5432/db"],
    ["a session cookie", "session_token=0123456789abcdef"],
    ["a key assignment", "api_key = abcdef123456"],
    ["a password assignment", "password: hunter2hunter2"]
  ])("redacts %s even inside an allowed field", (_n, value) => {
    const { logger, lines } = capture();
    logger.error("http.error", { errorName: value });
    expect(lines[0]).toContain("[redacted]");
    expect(lines[0]).not.toContain(value);
  });

  it("truncates long strings, strips control characters (no log-line injection) and rejects bad event names", () => {
    const { logger, lines, records } = capture();
    logger.info("http.request", { route: `a\nFAKE-LOG-LINE\r\n${"x".repeat(500)}` });
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toMatch(/\n./);
    expect(String(records()[0]!.route).length).toBeLessThanOrEqual(130);
    expect(String(records()[0]!.route)).not.toMatch(/[\r\n]/); // checked on the PARSED value: JSON escaping alone would hide an unstripped newline
    logger.info("Not A Valid Event!", {});
    expect(records()[1]!.event).toBe("invalid_event_name");
    expect(sanitizeValue(NaN)).toBeNull();
  });

  it("honours the minimum level and never throws if the sink does", () => {
    const quiet = capture({ level: "warn" });
    quiet.logger.info("a.b");
    quiet.logger.warn("a.b");
    expect(quiet.lines).toHaveLength(1);
    const broken = createLogger({ sink: () => { throw new Error("disk full"); } });
    expect(() => broken.error("a.b")).not.toThrow();
  });

  it("the allowlist contains no field that could carry content (prompt, response, key, text, body, cookie, password, token, email)", () => {
    expect((LOG_FIELDS as readonly string[]).filter((f) => /prompt|response|answer|key|text|body|cookie|password|token|email|reason|message|content|focus/i.test(f))).toEqual([]);
  });
});

describe("request context and correlation", () => {
  const ctx = (): RequestContext => ({ requestId: newRequestId(), method: "POST", route: "POST /v1/tutor/ask", actorKind: "anonymous", studentRef: null, examCode: null, startedAtMs: 0 });

  it("carries the request id through async boundaries and into every log line, and isolates concurrent requests", async () => {
    const { logger, records } = capture();
    const a = ctx();
    const b = ctx();
    await Promise.all([
      runWithContext(a, async () => {
        await new Promise((r) => setTimeout(r, 10));
        logger.info("a.event");
      }),
      runWithContext(b, async () => {
        logger.info("b.event");
        await new Promise((r) => setTimeout(r, 20));
        logger.info("b.later");
      })
    ]);
    const byEvent = Object.fromEntries(records().map((r) => [r.event as string, r.requestId]));
    expect(byEvent).toEqual({ "a.event": a.requestId, "b.event": b.requestId, "b.later": b.requestId });
    expect(currentContext()).toBeUndefined();
  });

  it("updateContext records the actor only for the current request; the student appears as a one-way reference", () => {
    const { logger, records } = capture();
    const c = ctx();
    runWithContext(c, () => {
      updateContext({ actorKind: "student", studentRef: studentRef("11111111-1111-1111-1111-111111111111") });
      logger.info("x.y");
    });
    const [r] = records();
    expect(r).toMatchObject({ actorKind: "student", studentRef: studentRef("11111111-1111-1111-1111-111111111111") });
    expect(JSON.stringify(r)).not.toContain("11111111-1111");
    expect(studentRef("a")).not.toBe(studentRef("b"));
    expect(studentRef("a")).toMatch(/^[0-9a-f]{12}$/);
    updateContext({ actorKind: "staff" }); // outside any request: a no-op, never a global
    expect(currentContext()).toBeUndefined();
  });

  it("request ids are unique server-generated UUIDs", () => {
    const ids = new Set(Array.from({ length: 200 }, () => newRequestId()));
    expect(ids.size).toBe(200);
    expect([...ids][0]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe("metrics: counters, histograms, bounded cardinality", () => {
  it("counts and records latency into fixed buckets", () => {
    const m = createMetrics();
    m.inc("http_requests_total", { route: "GET /v1/x", status: 200 });
    m.inc("http_requests_total", { route: "GET /v1/x", status: 200 }, 2);
    m.observeMs("latency_ms", 7);
    m.observeMs("latency_ms", 700);
    const snap = m.snapshot();
    expect(snap.counters).toEqual([{ name: "http_requests_total", labels: { route: "GET /v1/x", status: "200" }, value: 3 }]);
    const h = snap.histograms[0]!;
    expect([h.count, h.sumMs]).toEqual([2, 707]);
    expect(h.buckets.find((b) => b.leMs === 10)!.count).toBe(1);
    expect(h.buckets.find((b) => b.leMs === 1000)!.count).toBe(2);
    expect(h.buckets.at(-1)).toEqual({ leMs: "+Inf", count: 2 });
    expect(h.buckets).toHaveLength(LATENCY_BUCKETS_MS.length + 1);
  });

  it("ignores unknown label names, invalid metric names and non-finite values", () => {
    const m = createMetrics();
    m.inc("Bad Name!", {});
    m.inc("ok_total", { evil: "x", route: "r" } as never);
    m.inc("ok_total", { route: "r" }, NaN);
    m.observeMs("ok_ms", -5);
    m.observeMs("ok_ms", Infinity);
    expect(m.snapshot().counters).toEqual([{ name: "ok_total", labels: { route: "r" }, value: 1 }]); // exact: an unknown label name must not survive
    expect(m.snapshot().histograms).toEqual([]);
  });

  it("bounds the number of series: extra label values are counted as overflow, memory cannot grow without limit", () => {
    const m = createMetrics({ maxSeries: 10 });
    for (let i = 0; i < 1000; i += 1) m.inc("hits_total", { route: `/unique/${i}` });
    const s = m.snapshot();
    expect(s.counters.length).toBe(10);
    expect(s.overflow).toBe(990);
  });

  it("timed() records ok and error outcomes and rethrows the original error", async () => {
    const m = createMetrics();
    await timed(m, "op_ms", { operation: "x" }, async () => 1);
    const boom = new Error("boom");
    await expect(timed(m, "op_ms", { operation: "x" }, async () => { throw boom; })).rejects.toBe(boom);
    expect(m.snapshot().histograms.map((h) => h.labels.outcome).sort()).toEqual(["error", "ok"]);
  });
});

describe("rate limiter: fixed window, server clock only", () => {
  const rule = { limit: 3, windowMs: 1000 };
  it("allows `limit` hits per window, then denies with a Retry-After, then resets", () => {
    let t = 10_000;
    const rl = createRateLimiter({ now: () => t });
    const d = [1, 2, 3, 4, 5].map(() => rl.hit("tutor", "student-a", rule));
    expect(d.map((x) => x.allowed)).toEqual([true, true, true, false, false]);
    expect(d.map((x) => x.remaining)).toEqual([2, 1, 0, 0, 0]);
    expect(d[3]!.retryAfterSeconds).toBe(1);
    t += 999;
    expect(rl.hit("tutor", "student-a", rule).allowed).toBe(false);
    t += 1;
    expect(rl.hit("tutor", "student-a", rule).allowed).toBe(true);
  });

  it("isolates keys and buckets from each other", () => {
    const rl = createRateLimiter({ now: () => 0 });
    for (let i = 0; i < 3; i += 1) rl.hit("tutor", "a", rule);
    expect(rl.hit("tutor", "a", rule).allowed).toBe(false);
    expect(rl.hit("tutor", "b", rule).allowed).toBe(true);
    expect(rl.hit("api", "a", rule).allowed).toBe(true);
  });

  it("is memory-bounded and fails CLOSED under key flooding: a full table evicts the oldest window, it never switches the limiter off", () => {
    const rl = createRateLimiter({ now: () => 0, maxKeys: 50 });
    for (let i = 0; i < 5000; i += 1) rl.hit("ip", `10.0.${i}`, rule);
    expect(rl.size()).toBeLessThanOrEqual(50);
    for (let i = 0; i < 3; i += 1) rl.hit("ip", "attacker", rule);
    expect(rl.hit("ip", "attacker", rule).allowed).toBe(false);
  });

  it("rejects an invalid rule instead of silently allowing everything", () => {
    const rl = createRateLimiter();
    expect(() => rl.hit("b", "k", { limit: 0, windowMs: 1000 })).toThrow();
    expect(() => rl.hit("b", "k", { limit: 1, windowMs: 0 })).toThrow();
  });
});

describe("concurrency gate", () => {
  it("caps in-flight operations per key; release is idempotent and frees exactly one slot", () => {
    const gate = createConcurrencyGate({ max: 2 });
    const r1 = gate.acquire("a")!;
    const r2 = gate.acquire("a")!;
    expect(gate.acquire("a")).toBeNull();
    expect(gate.acquire("b")).not.toBeNull();
    r1();
    r1(); // a double release must not free someone else's slot
    expect(gate.inFlight("a")).toBe(1);
    expect(gate.acquire("a")).not.toBeNull();
    expect(gate.acquire("a")).toBeNull();
    r2();
  });
});
