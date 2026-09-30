import { useEffect, useRef, useState } from "react";
import type { QuestionViewModel } from "../adapter/index.js";
import { Button, ErrorNotice, FormField, Screen } from "../design/index.js";
import { elapsedSecondsBetween } from "../practice/elapsed.js";
import { Timer } from "./Timer.js";

/**
 * `submitting`/`submitError` (Product Phase 1 Unit 11) are display-only inputs from the route
 * that owns the request: while `submitting`, every option and the Submit button are disabled (no
 * duplicate submission, no changing the answer mid-request); `submitError` is student-safe copy
 * shown in place, above the still-usable controls, so the student can retry.
 */
export function QuestionPlayer({
  question,
  onSubmit,
  submitting = false,
  submitError = null
}: {
  question: QuestionViewModel;
  onSubmit: (chosenAnswer: string, timeTakenSeconds: number) => void;
  submitting?: boolean;
  submitError?: string | null;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const elapsedRef = useRef(0);

  useEffect(() => {
    setSelected(null);
    // Seeded from the SERVER's attempt clock (0 for a fresh attempt; larger when a reload resumed an open one), then
    // advanced by the wall clock. Display only -- time spent is always derived server-side.
    const seed = question.elapsedSeconds;
    setElapsedSeconds(seed);
    elapsedRef.current = seed;
    const startedAt = Date.now() - seed * 1000;
    const interval = window.setInterval(() => {
      elapsedRef.current = elapsedSecondsBetween(startedAt, Date.now());
      setElapsedSeconds(elapsedRef.current);
    }, 1000);
    return () => window.clearInterval(interval);
  }, [question.questionId]);

  // A question with no options is a typed-answer (numeric_entry) question -- the student
  // types the answer; grading is still entirely server-side.
  const hasOptions = (question.options?.length ?? 0) > 0;

  function handleSubmit() {
    if (!selected || submitting) return;
    onSubmit(selected.trim(), elapsedRef.current);
  }

  return (
    <Screen>
      <h1 className="visually-hidden">Practice question</h1>
      <Timer elapsedSeconds={elapsedSeconds} expectedSeconds={question.expectedTimeSeconds} />
      <p className="question-topic question-topic-spaced">
        {question.chapterName} &middot; {question.conceptName}
      </p>
      <p className="prompt-text" id="question-prompt">
        {question.prompt}
      </p>

      {hasOptions ? (
        <div className="options-grid" role="group" aria-labelledby="question-prompt">
          {question.options?.map((option) => (
            <button
              key={option}
              type="button"
              className={`option${selected === option ? " selected" : ""}`}
              aria-pressed={selected === option}
              disabled={submitting}
              onClick={() => setSelected(option)}
            >
              {option}
            </button>
          ))}
        </div>
      ) : (
        <FormField label="Your answer" htmlFor="numeric-answer">
          <input
            id="numeric-answer"
            className="form-input"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={selected ?? ""}
            disabled={submitting}
            onChange={(event) => setSelected(event.target.value.trim() === "" ? null : event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") handleSubmit();
            }}
          />
        </FormField>
      )}

      {submitError && <ErrorNotice>{submitError}</ErrorNotice>}

      <Button block disabled={!selected || submitting} onClick={handleSubmit}>
        {submitting ? "Submitting…" : "Submit answer"}
      </Button>
    </Screen>
  );
}
