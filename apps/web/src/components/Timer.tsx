function formatClock(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/**
 * Purely presentational -- the ticking clock lives in QuestionPlayer, which owns the actual elapsed-time state.
 * `role="timer"` (implicitly NOT a live region, so the per-second tick is never announced) plus an explicit
 * label lets assistive tech find the elapsed time without the visual-only "0:07" being ambiguous.
 */
export function Timer({ elapsedSeconds, expectedSeconds }: { elapsedSeconds: number; expectedSeconds: number }) {
  const overPace = elapsedSeconds > expectedSeconds;
  const progress = Math.min(100, (elapsedSeconds / expectedSeconds) * 100);

  return (
    <div>
      <div className="question-meta">
        <span className="question-topic">Expected time: {formatClock(expectedSeconds)}</span>
        <span className={`timer${overPace ? " over-pace" : ""}`} role="timer" aria-label="Elapsed time">
          {formatClock(elapsedSeconds)}
        </span>
      </div>
      <div className="timer-track" aria-hidden="true">
        <div className={`timer-fill${overPace ? " over-pace" : ""}`} style={{ width: `${progress}%` }} />
      </div>
    </div>
  );
}
