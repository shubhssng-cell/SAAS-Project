/**
 * Where a submitted attempt's result lives in the URL (Product Phase 2 Unit 3).
 * The result route stays `/practice/:questionId/result`; the attempt id rides in
 * a query parameter so a hard refresh (which loses in-memory session state) can
 * re-read the result from the server. The id is opaque and useless to anyone but
 * the owning student -- the server re-checks ownership on every read.
 */
export function resultPath(questionId: string, attemptId: string): string {
  return `/practice/${questionId}/result?attempt=${encodeURIComponent(attemptId)}`;
}

/** The attempt id from a URL search string, or `null` when absent/blank. */
export function readAttemptParam(search: string): string | null {
  const value = new URLSearchParams(search).get("attempt");
  return value !== null && value.trim() !== "" ? value : null;
}
