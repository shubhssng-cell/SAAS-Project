/**
 * `timeTaken / expectedTime`, computed ONLY when both are present, finite,
 * and `expectedTime > 0` — mirrors (independently, not imported)
 * `@ipmat/autopsy`'s own `computeSpeedRatio()` convention, which is a
 * local, non-exported function there. No existing package exports a
 * precomputed per-attempt speedRatio, so this small, self-contained
 * helper is the correct, minimal way to derive it from
 * `MasteryAttemptRecord.contribution` directly.
 */
export function computeSpeedRatio(timeTakenSeconds: number | null, expectedTimeSeconds: number | null): number | null {
  if (timeTakenSeconds === null || expectedTimeSeconds === null) return null;
  if (!Number.isFinite(timeTakenSeconds) || !Number.isFinite(expectedTimeSeconds)) return null;
  if (expectedTimeSeconds <= 0) return null;
  return timeTakenSeconds / expectedTimeSeconds;
}
