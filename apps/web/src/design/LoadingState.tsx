/**
 * The one loading-state primitive (Product Phase 1 Unit 11) -- replaces a bare
 * `<p className="loading-text">` that every route/gate repeated. `role="status"` makes the
 * message a polite live region so assistive tech announces it; `aria-busy` marks the region
 * as still updating. Purely presentational: shows only the message it is given.
 */
export function LoadingState({ message }: { message: string }) {
  return (
    <p className="loading-text" role="status" aria-live="polite" aria-busy="true">
      {message}
    </p>
  );
}
