import type { PhaseCurvePoint } from "./types.js";

const MS_PER_DAY = 1000 * 60 * 60 * 24;

export function diffInDays(later: string, earlier: string): number {
  const laterMs = new Date(later).getTime();
  const earlierMs = new Date(earlier).getTime();
  return Math.round((laterMs - earlierMs) / MS_PER_DAY);
}

/**
 * Picks the curve point for the tightest threshold already crossed, given
 * how many days remain until the exam. Points are milestones like
 * { daysToExam: 180, expectedCoverage: {...} } meaning "once 180 days or
 * fewer remain, expect this coverage" — so we want the smallest
 * daysToExam that is still >= daysRemaining (the most recently crossed
 * milestone), falling back to the earliest-defined point if the exam is
 * still further away than every milestone.
 */
export function selectPhasePoint(curve: PhaseCurvePoint[], daysRemaining: number): PhaseCurvePoint {
  if (curve.length === 0) {
    throw new Error("phase curve must have at least one point");
  }
  const descending = [...curve].sort((a, b) => b.daysToExam - a.daysToExam);
  const eligible = descending.filter((point) => point.daysToExam >= daysRemaining);
  if (eligible.length > 0) {
    return eligible[eligible.length - 1] as PhaseCurvePoint;
  }
  return descending[0] as PhaseCurvePoint;
}

export function curveStartPoint(curve: PhaseCurvePoint[]): PhaseCurvePoint {
  return [...curve].sort((a, b) => b.daysToExam - a.daysToExam)[0] as PhaseCurvePoint;
}
