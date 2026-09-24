function formatClock(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/** Purely presentational -- the ticking clock lives in QuestionPlayer, which owns the actual elapsed-time state. */
export function Timer({ elapsedSeconds, expectedSeconds }: { elapsedSeconds: number; expectedSeconds: number }) {
  const overPace = elapsedSeconds > expectedSeconds;
  const progress = Math.min(100, (elapsedSeconds / expectedSeconds) * 100);

  return (
    <div>
      <div className="question-meta">
        <span className="question-topic">Expected time: {formatClock(expectedSeconds)}</span>
        <span className={`timer${overPace ? " over-pace" : ""}`}>{formatClock(elapsedSeconds)}</span>
      </div>
      <div className="timer-track">
        <div className={`timer-fill${overPace ? " over-pace" : ""}`} style={{ width: `${progress}%` }} />
      </div>
    </div>
  );
}
