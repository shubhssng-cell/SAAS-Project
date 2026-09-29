import { describe, expect, it } from "vitest";
import type { RecommendationViewModel } from "../../src/adapter/index.js";
import { decidePracticeEntryOutcome } from "../../src/practice/practiceEntry.js";

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
