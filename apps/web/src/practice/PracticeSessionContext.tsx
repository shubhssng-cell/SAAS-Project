import { createContext, useContext, useMemo, useRef, type ReactNode } from "react";
import { createFixtureTrainingAdapter, type AttemptResultViewModel, type AutopsyViewModel, type TrainingRecommendationAdapter } from "../adapter/index.js";

/**
 * Holds the ONE adapter instance for this session, plus the minimum
 * transient UI-navigation state needed to reconstruct the fixture-backed
 * practice flow across route changes. `TrainingRecommendationAdapter` has
 * no "fetch by id" method -- `submitAnswer()`/`getAutopsy()` return a
 * result/hypothesis inline, once -- so the result and autopsy routes need
 * somewhere to read what a prior step already returned. This stores
 * exactly that (keyed by questionId / attemptId), makes no decisions of
 * its own, and is intentionally lost on a hard page refresh, same as the
 * pre-Unit-2 in-memory `Screen` state was (see PHASE_1_PLATFORM_SHELL.md's
 * Unit 2 notes for why this is accepted rather than expanded into real
 * persistence in this unit).
 *
 * This is UI session state, not a second adapter/decision engine -- every
 * value stored here is a value `TrainingRecommendationAdapter` itself
 * already produced.
 */
interface PracticeSessionValue {
  adapter: TrainingRecommendationAdapter;
  getLastResult: (questionId: string) => AttemptResultViewModel | undefined;
  setLastResult: (questionId: string, result: AttemptResultViewModel) => void;
  getLastAutopsy: (attemptId: string) => AutopsyViewModel | undefined;
  setLastAutopsy: (attemptId: string, autopsy: AutopsyViewModel) => void;
}

const PracticeSessionContext = createContext<PracticeSessionValue | null>(null);

export function PracticeSessionProvider({ children }: { children: ReactNode }) {
  const adapter = useMemo(() => createFixtureTrainingAdapter(), []);
  const resultsByQuestion = useRef(new Map<string, AttemptResultViewModel>());
  const autopsyByAttempt = useRef(new Map<string, AutopsyViewModel>());

  const value = useMemo<PracticeSessionValue>(
    () => ({
      adapter,
      getLastResult: (questionId) => resultsByQuestion.current.get(questionId),
      setLastResult: (questionId, result) => resultsByQuestion.current.set(questionId, result),
      getLastAutopsy: (attemptId) => autopsyByAttempt.current.get(attemptId),
      setLastAutopsy: (attemptId, autopsy) => autopsyByAttempt.current.set(attemptId, autopsy)
    }),
    [adapter]
  );

  return <PracticeSessionContext.Provider value={value}>{children}</PracticeSessionContext.Provider>;
}

export function usePracticeSession(): PracticeSessionValue {
  const ctx = useContext(PracticeSessionContext);
  if (!ctx) throw new Error("usePracticeSession must be used within PracticeSessionProvider");
  return ctx;
}
