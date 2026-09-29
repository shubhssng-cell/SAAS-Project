import { useEffect, useState } from "react";
import type { QuestionViewModel } from "../adapter/index.js";
import { QuestionPlayer } from "../components/QuestionPlayer.js";
import { usePracticeSession } from "../practice/PracticeSessionContext.js";
import { useNavigate } from "../router/router.js";

export function PracticeQuestionRoute({ questionId }: { questionId: string }) {
  const { adapter, setLastResult } = usePracticeSession();
  const navigate = useNavigate();
  const [question, setQuestion] = useState<QuestionViewModel | null>(null);

  useEffect(() => {
    let cancelled = false;
    setQuestion(null);
    adapter.loadQuestion(questionId).then((result) => {
      if (!cancelled) setQuestion(result);
    });
    return () => {
      cancelled = true;
    };
  }, [adapter, questionId]);

  if (!question) return <p className="loading-text">Loading question…</p>;

  async function handleSubmit(chosenAnswer: string, timeTakenSeconds: number) {
    const result = await adapter.submitAnswer({ questionId, chosenAnswer, timeTakenSeconds });
    setLastResult(questionId, result);
    navigate(`/practice/${questionId}/result`);
  }

  return <QuestionPlayer question={question} onSubmit={handleSubmit} />;
}
