/**
 * Whole seconds elapsed between two wall-clock readings (Product Phase 2 Unit 2).
 * The timer displays this instead of counting interval ticks, because browsers
 * throttle timers in background tabs -- a tick counter would under-report. Display
 * only: the authoritative time spent is derived server-side (D-034).
 */
export function elapsedSecondsBetween(startMs: number, nowMs: number): number {
  return Math.max(0, Math.floor((nowMs - startMs) / 1000));
}
