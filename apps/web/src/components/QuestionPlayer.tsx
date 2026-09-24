import { useEffect, useRef, useState } from "react";
import type { QuestionViewModel } from "../adapter/index.js";
import { Timer } from "./Timer.js";

export function QuestionPlayer({ question, onSubmit }: { question: QuestionViewModel; onSubmit: (chosenAnswer: string, timeTakenSeconds: number) => void }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const elapsedRef = useRef(0);

  useEffect(() => {
    setSelected(null);
    setElapsedSeconds(0);
    elapsedRef.current = 0;
    const interval = window.setInterval(() => {
      elapsedRef.current += 1;
      setElapsedSeconds(elapsedRef.current);
    }, 1000);
    return () => window.clearInterval(interval);
  }, [question.questionId]);

  function handleSubmit() {
    if (!selected) return;
    onSubmit(selected, elapsedRef.current);
  }

  return (
    <div className="screen">
      <Timer elapsedSeconds={elapsedSeconds} expectedSeconds={question.expectedTimeSeconds} />
      <p className="question-topic" style={{ marginBottom: 10 }}>
        {question.chapterName} &middot; {question.conceptName}
      </p>
      <p className="prompt-text">{question.prompt}</p>

      <div className="options-grid">
        {question.options?.map((option) => (
          <button key={option} type="button" className={`option${selected === option ? " selected" : ""}`} onClick={() => setSelected(option)}>
            {option}
          </button>
        ))}
      </div>

      <button type="button" className="btn btn-primary btn-block" disabled={!selected} onClick={handleSubmit}>
        Submit answer
      </button>
    </div>
  );
}
