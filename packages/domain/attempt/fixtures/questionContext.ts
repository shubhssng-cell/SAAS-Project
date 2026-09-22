import type { AttemptQuestionContext } from "../src/types.js";

/** A deterministic stand-in for a real `Question` row, mirroring the one hand-authored Percentages question from Phase 2. */
export const mcqQuestionContext: AttemptQuestionContext = {
  questionId: "question-reverse-percentage-1",
  conceptId: "concept-percentages",
  answerFormat: "multiple_choice",
  options: ["420", "450", "480", "500"],
  correctAnswer: "480",
  expectedTimeSeconds: 90
};

export const numericEntryQuestionContext: AttemptQuestionContext = {
  questionId: "question-numeric-entry-1",
  conceptId: "concept-percentages",
  answerFormat: "numeric_entry",
  options: null,
  correctAnswer: "480",
  expectedTimeSeconds: 90
};

/** A second, unrelated question — used to construct an ownership-mismatch case. */
export const otherQuestionContext: AttemptQuestionContext = {
  questionId: "question-other-1",
  conceptId: "concept-ratio",
  answerFormat: "multiple_choice",
  options: ["1", "2", "3"],
  correctAnswer: "2",
  expectedTimeSeconds: 60
};

export const STUDENT_ID = "student-1";
export const ENROLLMENT_ID = "enrollment-1";
export const OTHER_STUDENT_ID = "student-2";
