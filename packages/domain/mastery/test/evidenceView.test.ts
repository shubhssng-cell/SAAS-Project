import { describe, expect, it } from "vitest";
import { buildComponentDetail } from "../src/componentDetail.js";
import { buildMasteryEvidenceView, computeMasteryState, MASTERY_EVIDENCE_STATUS, type MasteryAttemptRecord } from "../src/index.js";
import { CONCEPT_ID, CONCEPT_NAME, hardNovelQuestion, otherPatternFamilyQuestion, pressureQuestion, record, standardQuestion, STUDENT_ID } from "../fixtures/attemptRecord.js";

const scope = { studentId: STUDENT_ID, examCode: "IPMAT_INDORE" };
const view = (records: MasteryAttemptRecord[], extra: { conceptNames?: string[] } = {}) => buildMasteryEvidenceView(records, { ...scope, ...extra });
const concept = (records: MasteryAttemptRecord[], name = CONCEPT_NAME) => view(records).concepts.find((c) => c.conceptName === name)!;

describe("evidence-only: the view makes no mastery judgment", () => {
  it("carries the evidence_only marker and has no verdict, score, level or threshold anywhere", () => {
    const v = view([record(0), record(1, { isCorrect: false })]);
    expect(v.status).toBe(MASTERY_EVIDENCE_STATUS);
    const keys = new Set<string>();
    const walk = (o: unknown): void => {
      if (Array.isArray(o)) o.forEach(walk);
      else if (o && typeof o === "object") for (const [k, val] of Object.entries(o)) { keys.add(k); walk(val); }
    };
    walk(v);
    for (const k of keys) expect(k, k).not.toMatch(/mastered|mastery|score|verdict|threshold|confidence|ability|readiness|probab|predict|rating|^level$|^grade$/i);
  });
  it("the existing five-measure computation is unchanged by the new view", () => {
    const records = [record(0), record(1, { isCorrect: false }), record(2), record(3)];
    const before = computeMasteryState(records, { studentId: STUDENT_ID, conceptId: CONCEPT_ID, conceptName: CONCEPT_NAME, now: "2026-10-03T00:00:00.000Z" });
    view(records);
    expect(computeMasteryState(records, { studentId: STUDENT_ID, conceptId: CONCEPT_ID, conceptName: CONCEPT_NAME, now: "2026-10-03T00:00:00.000Z" })).toEqual(before);
    expect(before.measures.accuracy).toBe(0.75);
  });
});

describe("attempt counts alongside distinct-question counts (never substituted)", () => {
  it("ten attempts on one question are 10 attempts but 1 distinct question", () => {
    const o = concept(Array.from({ length: 10 }, (_, i) => record(i)));
    expect(o.overall).toMatchObject({ attempts: 10, gradedAttempts: 10, distinctQuestions: 1, distinctGradedQuestions: 1 });
  });
  it("ten attempts on ten different questions are 10 attempts and 10 distinct questions", () => {
    const o = concept(Array.from({ length: 10 }, (_, i) => record(i, {}, { ...standardQuestion, questionId: `q-${i}` })));
    expect(o.overall).toMatchObject({ attempts: 10, distinctQuestions: 10 });
  });
  it("the two are never conflated, and per-question exposure is preserved", () => {
    const o = concept([record(0), record(1, { isCorrect: false }), record(2), record(3, {}, hardNovelQuestion)]);
    expect(o.overall).toMatchObject({ attempts: 4, distinctQuestions: 2, correctGradedAttempts: 3, incorrectGradedAttempts: 1 });
    expect(o.questions).toEqual([
      expect.objectContaining({ questionId: "question-hard-novel-1", attempts: 1, gradedAttempts: 1 }),
      expect.objectContaining({ questionId: "question-standard-1", attempts: 3, gradedAttempts: 3, correctGradedAttempts: 2 })
    ]);
  });
  it("agrees with the existing detail on the shared counts", () => {
    const records = [record(0), record(1, { isCorrect: false }), record(2, { status: "skipped", isCorrect: null, skipped: true }), record(3, { status: "abandoned", isCorrect: null })];
    const o = concept(records).overall;
    const d = buildComponentDetail(records);
    expect([o.attempts, o.gradedAttempts, o.skippedAttempts, o.abandonedAttempts, o.correctGradedAttempts, o.incorrectGradedAttempts]).toEqual([d.totalAttempts, d.submittedAttempts, d.skippedAttempts, d.abandonedAttempts, d.correctCount, d.incorrectCount]);
  });
});

describe("skips, abandons and ungraded attempts stay separate from graded evidence", () => {
  const skip = (n: number, q = standardQuestion) => record(n, { status: "skipped", isCorrect: null, skipped: true, timeTakenSeconds: null }, q);
  it("a skip is neither correct nor incorrect and is not graded", () => {
    const o = concept([record(0), skip(1)]).overall;
    expect(o).toMatchObject({ attempts: 2, gradedAttempts: 1, skippedAttempts: 1, correctGradedAttempts: 1, incorrectGradedAttempts: 0 });
  });
  it("only skips: zero graded evidence, not zero accuracy", () => {
    const o = concept([skip(0), skip(1, hardNovelQuestion)]).overall;
    expect(o).toMatchObject({ gradedAttempts: 0, correctGradedAttempts: 0, incorrectGradedAttempts: 0, skippedAttempts: 2, distinctGradedQuestions: 0, distinctSkippedQuestions: 2 });
    expect(JSON.stringify(o)).not.toMatch(/accuracy/i);
  });
  it("a submitted attempt with no recorded correctness is its own category", () => {
    const o = concept([record(0, { isCorrect: null }), record(1)]).overall;
    expect(o).toMatchObject({ attempts: 2, gradedAttempts: 1, ungradedAttempts: 1 });
  });
  it("attempts always partition into graded + skipped + abandoned + ungraded", () => {
    const o = concept([record(0), record(1, { isCorrect: false }), skip(2), record(3, { status: "abandoned", isCorrect: null }), record(4, { isCorrect: null })]).overall;
    expect(o.gradedAttempts + o.skippedAttempts + o.abandonedAttempts + o.ungradedAttempts).toBe(o.attempts);
  });
});

describe("indexed by pattern family, novelty level and testing mode", () => {
  const records = [
    record(0, {}, standardQuestion), // Reverse Percentage / standard / direct
    record(1, { isCorrect: false }, hardNovelQuestion), // Reverse Percentage / novel_representation / reverse + novel_representation
    record(2, {}, pressureQuestion), // Reverse Percentage / standard / direct + time_pressured
    record(3, {}, otherPatternFamilyQuestion) // Successive Percentage Change / standard / direct
  ];
  const c = concept(records);
  it("pattern family: each attempt in exactly one bucket (they sum to overall)", () => {
    expect(Object.keys(c.byPatternFamily)).toEqual(["Reverse Percentage", "Successive Percentage Change"]);
    expect(c.byPatternFamily["Reverse Percentage"]!.attempts).toBe(3);
    expect(c.byPatternFamily["Successive Percentage Change"]!.attempts).toBe(1);
    expect(Object.values(c.byPatternFamily).reduce((s, b) => s + b.attempts, 0)).toBe(c.overall.attempts);
  });
  it("novelty level: standard-form evidence is separate from novel-form evidence", () => {
    expect(c.byNoveltyLevel.standard).toMatchObject({ attempts: 3, correctGradedAttempts: 3 });
    expect(c.byNoveltyLevel.novel_representation).toMatchObject({ attempts: 1, incorrectGradedAttempts: 1 });
    expect(c.byNoveltyLevel.novel_context).toBeUndefined(); // never encountered: absent, not zero
    expect(Object.values(c.byNoveltyLevel).reduce((s, b) => s + b!.attempts, 0)).toBe(c.overall.attempts);
  });
  it("testing mode: an attempt appears under every mode its question lists (so modes overlap)", () => {
    expect(c.byTestingMode.direct!.attempts).toBe(3);
    expect(c.byTestingMode.time_pressured!.attempts).toBe(1);
    expect(c.byTestingMode.reverse!.attempts).toBe(1);
    expect(c.byTestingMode.novel_representation!.attempts).toBe(1);
    expect(Object.values(c.byTestingMode).reduce((s, b) => s + b.attempts, 0)).toBeGreaterThan(c.overall.attempts);
  });
  it("buckets carry distinct-question counts too", () => {
    expect(c.byPatternFamily["Reverse Percentage"]!.distinctQuestions).toBe(3);
  });
  it("never encountered pattern/mode has no key (low exposure is not a conclusion)", () => {
    expect(c.byPatternFamily["Percentage Share in Data Interpretation"]).toBeUndefined();
    expect(c.byTestingMode.contextualized).toBeUndefined();
  });
  it("keys are sorted and no key is lowercased/merged", () => {
    expect(Object.keys(c.byTestingMode)).toEqual([...Object.keys(c.byTestingMode)].sort());
  });
});

describe("time evidence stays separate from correctness and is never interpreted", () => {
  it("keeps observed and expected time paired with correctness for graded attempts", () => {
    const o = concept([record(0, { timeTakenSeconds: 30, expectedTimeSeconds: 90 }), record(1, { isCorrect: false, timeTakenSeconds: 200, expectedTimeSeconds: 90 })]).overall;
    expect(o.timedObservations).toEqual([
      { attemptId: expect.any(String), isCorrect: true, observedSeconds: 30, expectedSeconds: 90 },
      { attemptId: expect.any(String), isCorrect: false, observedSeconds: 200, expectedSeconds: 90 }
    ]);
  });
  it("no ratio, fast/slow flag or time-based label is produced", () => {
    const text = JSON.stringify(concept([record(0, { timeTakenSeconds: 1, expectedTimeSeconds: 90 })]));
    expect(text).not.toMatch(/ratio|fast|slow|speed/i);
  });
  it("a missing expected time stays null; a missing observed time is not recorded; skips carry no timing", () => {
    const o = concept([record(0, { expectedTimeSeconds: null }), record(1, { timeTakenSeconds: null }), record(2, { status: "skipped", isCorrect: null, skipped: true })]).overall;
    expect(o.timedObservations).toHaveLength(1);
    expect(o.timedObservations[0]!.expectedSeconds).toBeNull();
  });
});

describe("no inference or propagation of any kind", () => {
  it("evidence on a hard question is just that: no tier-based conclusion appears", () => {
    expect(JSON.stringify(concept([record(0, {}, { ...hardNovelQuestion, questionId: "q-x" })]))).not.toMatch(/difficulty|tier|hard/i);
  });
  it("evidence on one concept never appears under another (no prerequisite or dependent propagation)", () => {
    const ratio = { ...standardQuestion, questionId: "q-ratio", conceptName: "Ratio" };
    const v = view([record(0), record(1, {}, ratio)]);
    expect(v.concepts.map((c) => c.conceptName)).toEqual(["Percentages", "Ratio"]);
    expect(v.concepts[0]!.overall.attempts).toBe(1);
    expect(v.concepts[1]!.overall.attempts).toBe(1);
  });
  it("order of attempts, repair, diagnosis or revision plays no role: timestamps only order the audit trail", () => {
    const records = [record(5), record(1), record(3, { isCorrect: false })];
    expect(concept(records).overall.contributingAttemptIds).toEqual([...records].sort((a, b) => a.contribution.finalizedAt!.localeCompare(b.contribution.finalizedAt!)).map((r) => r.contribution.attemptId));
    expect(concept(records).overall.correctGradedAttempts).toBe(2);
  });
});

describe("scoping: student, exam and the exam's concept universe", () => {
  it("another student's records are excluded and counted, never merged", () => {
    const v = view([record(0), record(1, { studentId: "student-2" })]);
    expect(v.includedAttempts).toBe(1);
    expect(v.excluded.otherStudent).toBe(1);
    expect(v.concepts[0]!.overall.attempts).toBe(1);
    expect(JSON.stringify(v)).not.toContain("student-2");
  });
  it("another exam's records never become this exam's evidence, even for an identically named concept", () => {
    const jee = { ...standardQuestion, questionId: "jee-q", examCode: "JEE_MAIN" };
    const v = view([record(0), record(1, {}, jee), record(2, {}, jee)]);
    expect(v.excluded.otherExam).toBe(2);
    expect(v.concepts[0]!.overall.attempts).toBe(1);
    expect(v.concepts[0]!.questions.map((q) => q.questionId)).toEqual(["question-standard-1"]);
    expect(buildMasteryEvidenceView([record(1, {}, jee)], { studentId: STUDENT_ID, examCode: "JEE_MAIN" }).concepts[0]!.overall.attempts).toBe(1); // a separate exam, a separate view
  });
  it("with an exam concept universe: concepts with no evidence appear EMPTY (absence of evidence, no verdict) and outsiders are excluded", () => {
    const stray = { ...standardQuestion, questionId: "q-stray", conceptName: "Not In Pack" };
    const v = view([record(0), record(1, {}, stray)], { conceptNames: ["Ratio", "Percentages", "Algebra"] });
    expect(v.concepts.map((c) => c.conceptName)).toEqual(["Algebra", "Percentages", "Ratio"]);
    expect(v.excluded.outsideConceptUniverse).toBe(1);
    const algebra = v.concepts[0]!;
    expect(algebra.overall).toMatchObject({ attempts: 0, gradedAttempts: 0, distinctQuestions: 0, timedObservations: [], contributingAttemptIds: [] });
    expect(algebra.byPatternFamily).toEqual({});
    expect(algebra.questions).toEqual([]);
  });
  it("without a universe, only concepts with evidence appear", () => {
    expect(view([]).concepts).toEqual([]);
    expect(view([record(0)]).concepts).toHaveLength(1);
  });
});

describe("evidence identity and audit", () => {
  it("an attempt id is ONE piece of evidence however many times it is supplied", () => {
    const a = record(0);
    const v = view([a, { ...a }, { ...a }]);
    expect(v.includedAttempts).toBe(1);
    expect(v.excluded.duplicateAttemptRecords).toBe(2);
    expect(v.concepts[0]!.overall.attempts).toBe(1);
  });
  it("every count is traceable to attempt ids: the audit list has exactly `attempts` entries, each in the view once", () => {
    const records = [record(0), record(1, { isCorrect: false }), record(2, { status: "skipped", isCorrect: null, skipped: true }), record(3, {}, hardNovelQuestion)];
    const c = concept(records);
    expect(c.overall.contributingAttemptIds).toHaveLength(c.overall.attempts);
    expect(new Set(c.overall.contributingAttemptIds).size).toBe(c.overall.attempts);
    expect(c.byNoveltyLevel.novel_representation!.contributingAttemptIds).toEqual([records[3]!.contribution.attemptId]);
    for (const bucket of [...Object.values(c.byPatternFamily), ...Object.values(c.byTestingMode)]) for (const id of bucket.contributingAttemptIds) expect(c.overall.contributingAttemptIds).toContain(id);
  });
  it("recomputation is deterministic and independent of input order", () => {
    const records = [record(0), record(1, { isCorrect: false }), record(2, {}, hardNovelQuestion), record(3, {}, pressureQuestion), record(4, { status: "skipped", isCorrect: null, skipped: true })];
    expect(view([...records].reverse())).toEqual(view(records));
    expect(view(records)).toEqual(view(records));
  });
  it("the input records are not mutated", () => {
    const records = [record(2), record(0)];
    const snapshot = JSON.stringify(records);
    view(records);
    expect(JSON.stringify(records)).toBe(snapshot);
  });
});

describe("insufficient evidence is reported as counts, not as a verdict", () => {
  it("a single graded attempt yields counts only; no threshold gates anything", () => {
    const o = concept([record(0)]).overall;
    expect(o).toMatchObject({ attempts: 1, gradedAttempts: 1, distinctQuestions: 1 });
    expect(JSON.stringify(o)).not.toMatch(/insufficient|sufficient|enough/i);
  });
});
