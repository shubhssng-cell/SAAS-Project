/**
 * The minimal metrics boundary (Phase 9 Unit 3, D-099): counters and fixed-bucket latency histograms, held in process memory.
 * This is deliberately not an analytics platform: there is no export, no storage and no HTTP exposure here. A snapshot can be
 * read by trusted code (a test, a future operator-authenticated endpoint, an exporter) - the application serves none to the
 * public.
 *
 * Label cardinality is bounded: only allowlisted label names are accepted, values are short and sanitized, and at most
 * `maxSeries` distinct series exist (the rest are counted in `overflow`), so a caller-influenced value can never grow memory
 * without bound.
 */
export const METRIC_LABELS = ["route", "status", "outcome", "bucket", "category", "provider", "operation", "check"] as const;
export type MetricLabel = (typeof METRIC_LABELS)[number];
export type MetricLabels = Partial<Record<MetricLabel, string | number>>;

export const LATENCY_BUCKETS_MS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000, 60000] as const;

export interface HistogramSnapshot {
  count: number;
  sumMs: number;
  /** cumulative count of observations <= each bound; the last entry is +Inf (= count) */
  buckets: Array<{ leMs: number | "+Inf"; count: number }>;
}

export interface MetricsSnapshot {
  counters: Array<{ name: string; labels: Record<string, string>; value: number }>;
  histograms: Array<{ name: string; labels: Record<string, string> } & HistogramSnapshot>;
  overflow: number;
}

export interface Metrics {
  inc(name: string, labels?: MetricLabels, by?: number): void;
  observeMs(name: string, ms: number, labels?: MetricLabels): void;
  snapshot(): MetricsSnapshot;
}

const NAME = /^[a-z][a-z0-9_]{0,63}$/;
const clean = (v: string | number): string => [...String(v)].filter((c) => c.charCodeAt(0) >= 32 && c.charCodeAt(0) !== 127).join("").slice(0, 64);

export function createMetrics(options: { maxSeries?: number } = {}): Metrics {
  const maxSeries = options.maxSeries ?? 500;
  const counters = new Map<string, { name: string; labels: Record<string, string>; value: number }>();
  const histograms = new Map<string, { name: string; labels: Record<string, string>; count: number; sumMs: number; bucketCounts: number[] }>();
  let overflow = 0;

  function key(name: string, labels: MetricLabels | undefined): { key: string; labels: Record<string, string> } | null {
    if (!NAME.test(name)) return null;
    const out: Record<string, string> = {};
    for (const label of METRIC_LABELS) {
      const v = labels?.[label];
      if (v !== undefined) out[label] = clean(v);
    }
    return { key: `${name}|${JSON.stringify(out)}`, labels: out };
  }

  return {
    inc(name, labels, by = 1) {
      const k = key(name, labels);
      if (!k || !Number.isFinite(by)) return;
      const existing = counters.get(k.key);
      if (existing) existing.value += by;
      else if (counters.size + histograms.size >= maxSeries) overflow += 1;
      else counters.set(k.key, { name, labels: k.labels, value: by });
    },
    observeMs(name, ms, labels) {
      const k = key(name, labels);
      if (!k || !Number.isFinite(ms) || ms < 0) return;
      let h = histograms.get(k.key);
      if (!h) {
        if (counters.size + histograms.size >= maxSeries) {
          overflow += 1;
          return;
        }
        h = { name, labels: k.labels, count: 0, sumMs: 0, bucketCounts: new Array(LATENCY_BUCKETS_MS.length).fill(0) as number[] };
        histograms.set(k.key, h);
      }
      h.count += 1;
      h.sumMs += ms;
      LATENCY_BUCKETS_MS.forEach((bound, i) => {
        if (ms <= bound) h!.bucketCounts[i] = (h!.bucketCounts[i] ?? 0) + 1;
      });
    },
    snapshot() {
      return {
        counters: [...counters.values()].map((c) => ({ ...c, labels: { ...c.labels } })),
        histograms: [...histograms.values()].map((h) => ({
          name: h.name,
          labels: { ...h.labels },
          count: h.count,
          sumMs: h.sumMs,
          buckets: [...LATENCY_BUCKETS_MS.map((leMs, i) => ({ leMs, count: h.bucketCounts[i] ?? 0 })), { leMs: "+Inf" as const, count: h.count }]
        })),
        overflow
      };
    }
  };
}

export const NOOP_METRICS: Metrics = { inc: () => undefined, observeMs: () => undefined, snapshot: () => ({ counters: [], histograms: [], overflow: 0 }) };

/** Runs `fn`, recording its latency and outcome (`ok` / `error`) under `name`. Errors are rethrown unchanged. */
export async function timed<T>(metrics: Metrics, name: string, labels: MetricLabels, fn: () => Promise<T>, now: () => number = Date.now): Promise<T> {
  const start = now();
  try {
    const result = await fn();
    metrics.observeMs(name, now() - start, { ...labels, outcome: "ok" });
    return result;
  } catch (error) {
    metrics.observeMs(name, now() - start, { ...labels, outcome: "error" });
    throw error;
  }
}
