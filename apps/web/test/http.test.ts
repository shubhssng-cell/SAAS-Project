import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { jsonRequest, REQUEST_TIMEOUT_MS, type FetchLike } from "../src/http.js";

describe("jsonRequest timeout (Product Phase 1 Unit 11)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("a request that never settles resolves to network_error after the timeout -- a loading screen can never hang forever", async () => {
    const hung: FetchLike = () => new Promise(() => {}); // ignores the abort signal entirely
    const pending = jsonRequest(hung, "GET", "/v1/anything");
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS + 1);
    await expect(pending).resolves.toEqual({ ok: false, failure: { kind: "network_error" } });
  });

  it("aborts the underlying request when the timeout fires", async () => {
    let signal: AbortSignal | undefined;
    const hung: FetchLike = (_url, init) => {
      signal = init?.signal ?? undefined;
      return new Promise(() => {});
    };
    const pending = jsonRequest(hung, "GET", "/v1/anything", undefined, 1000);
    await vi.advanceTimersByTimeAsync(1001);
    await pending;
    expect(signal?.aborted).toBe(true);
  });

  it("a response body that never arrives (headers received, json() hangs) also times out", async () => {
    const stalledBody: FetchLike = async () => ({ ok: true, status: 200, json: () => new Promise(() => {}) });
    const pending = jsonRequest(stalledBody, "GET", "/v1/anything", undefined, 1000);
    await vi.advanceTimersByTimeAsync(1001);
    await expect(pending).resolves.toEqual({ ok: false, failure: { kind: "network_error" } });
  });

  it("a normal fast response is unaffected and leaves no pending timer behind", async () => {
    const ok: FetchLike = async () => ({ ok: true, status: 200, json: async () => ({ hello: "world" }) });
    await expect(jsonRequest(ok, "GET", "/v1/anything")).resolves.toEqual({ ok: true, body: { hello: "world" } });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("a 401 is still mapped to not_authenticated, never to network_error", async () => {
    const unauthorized: FetchLike = async () => ({ ok: false, status: 401, json: async () => ({ error: { code: "not_authenticated", message: "no" } }) });
    await expect(jsonRequest(unauthorized, "GET", "/v1/anything")).resolves.toEqual({ ok: false, failure: { kind: "not_authenticated" } });
  });

  it("a fetch that rejects (offline) is still network_error, immediately", async () => {
    const offline: FetchLike = async () => {
      throw new TypeError("Failed to fetch");
    };
    await expect(jsonRequest(offline, "GET", "/v1/anything")).resolves.toEqual({ ok: false, failure: { kind: "network_error" } });
  });

  it("the default timeout is a sane bound (long enough for a slow network, short enough to surface a hang)", () => {
    expect(REQUEST_TIMEOUT_MS).toBeGreaterThanOrEqual(10_000);
    expect(REQUEST_TIMEOUT_MS).toBeLessThanOrEqual(60_000);
  });
});
