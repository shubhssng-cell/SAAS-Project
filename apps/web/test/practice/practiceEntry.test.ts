import { describe, expect, it } from "vitest";
import type { RecommendationViewModel } from "../../src/adapter/index.js";
import { decidePracticeEntryOutcome, describeRecommendation, PRACTICE_UNAVAILABLE_COPY } from "../../src/practice/practiceEntry.js";

const READY: RecommendationViewModel = { questionId: "q-reverse-1", headline: "Keep building your coverage", explanation: "...", modeLabel: "Coverage" };
const UNAVAILABLE: RecommendationViewModel = { questionId: null, headline: "Nothing to start yet", explanation: "...", modeLabel: "Coverage" };

describe("decidePracticeEntryOutcome", () => {
  it("resolves to ready with the real question id when the adapter has one", () => {
    expect(decidePracticeEntryOutcome(READY)).toEqual({ kind: "ready", questionId: "q-reverse-1" });
  });

  it("resolves to unavailable for the genuine 'nothing to recommend' case (questionId: null) -- never invents a fallback id", () => {
    expect(decidePracticeEntryOutcome(UNAVAILABLE)).toEqual({ kind: "unavailable" });
  });
});

describe("describeRecommendation (Product Phase 1 Unit 11)", () => {
  it("shows the server's own recommendation text unchanged when there IS a question to start", () => {
    expect(describeRecommendation(READY)).toEqual({ badge: "Coverage", headline: "Keep building your coverage", explanation: "..." });
  });

  it("swaps in the honest 'unavailable' copy for questionId: null -- never the server's 'all caught up' text next to a disabled button, and no badge", () => {
    const display = describeRecommendation({ questionId: null, headline: "You're all caught up", explanation: "Keep practicing to build up more evidence.", modeLabel: "Up to date" });
    expect(display).toEqual({ badge: null, headline: PRACTICE_UNAVAILABLE_COPY.headline, explanation: PRACTICE_UNAVAILABLE_COPY.explanation });
    expect(JSON.stringify(display)).not.toMatch(/caught up|keep practicing/i);
  });

  it("never yields an empty heading for a ready recommendation whose text fields came back empty", () => {
    const display = describeRecommendation({ questionId: "q-1", headline: "", explanation: "", modeLabel: "" });
    expect(display.headline.length).toBeGreaterThan(0);
    expect(display.badge).toBeNull();
    expect(display.explanation).toBeNull();
  });

  it("the unavailable copy makes no claim about WHY nothing is available or that the student has finished anything", () => {
    expect(JSON.stringify(PRACTICE_UNAVAILABLE_COPY)).not.toMatch(/caught up|finished|complete|no content|no questions/i);
  });
});
