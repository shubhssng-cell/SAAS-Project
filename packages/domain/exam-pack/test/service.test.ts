import { describe, expect, it } from "vitest";
import {
  ExamPackInvalidError,
  ExamPackNotFoundError,
  ExamPackQueryError,
  ExamPackService,
  InMemoryExamPackRepository,
  summarizePackValidationState,
  toPublicExamPackView
} from "../src/index.js";
import { makePack, prov, relation } from "./fixtures.js";

const serviceFor = (...packs: ReturnType<typeof makePack>[]) => new ExamPackService(new InMemoryExamPackRepository(packs));

describe("ExamPackService", () => {
  it("answers deterministic queries from a valid pack", async () => {
    const service = serviceFor(makePack());
    expect((await service.listSections("TEST_EXAM")).map((s) => s.key)).toEqual(["s1", "s2"]);
    expect((await service.listConcepts("TEST_EXAM")).map((c) => c.key)).toEqual(["a", "b", "c", "d", "e"]);
    expect(await service.getPrerequisites("TEST_EXAM", "c")).toEqual(["b"]);
    expect(await service.getUnlocks("TEST_EXAM", "a")).toEqual(["b"]);
    expect((await service.getAncestors("TEST_EXAM", "c")).map((r) => r.key)).toEqual(["b", "a"]);
    expect((await service.getDescendants("TEST_EXAM", "a")).map((r) => r.key)).toEqual(["b", "c"]);
    expect((await service.getSyllabusPathOfConcept("TEST_EXAM", "b")).map((n) => n.key)).toEqual(["s1/ch1", "s1/ch1/topic"]);
    expect(await service.getLearningOrder("TEST_EXAM")).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("throws a typed not-found error for an unknown exam", async () => {
    await expect(serviceFor(makePack()).listSections("NOPE")).rejects.toBeInstanceOf(ExamPackNotFoundError);
  });

  it("fails closed: an invalid pack is never queried, but its report is still readable", async () => {
    const broken = makePack({ relations: [...makePack().relations, relation("c", "a")] });
    const service = serviceFor(broken);
    await expect(service.getAncestors("TEST_EXAM", "c")).rejects.toBeInstanceOf(ExamPackInvalidError);
    await expect(service.getPublicView("TEST_EXAM")).rejects.toBeInstanceOf(ExamPackInvalidError);
    const report = await service.validationReport("TEST_EXAM");
    expect(report.valid).toBe(false);
    expect(report.issues.map((i) => i.code)).toContain("forbidden_cycle");
  });

  it("an unknown concept key is a typed query error", async () => {
    await expect(serviceFor(makePack()).getAncestors("TEST_EXAM", "ghost")).rejects.toBeInstanceOf(ExamPackQueryError);
  });

  it("keeps packs of different exams isolated", async () => {
    const other = makePack({ examCode: "OTHER_EXAM", name: "Other", concepts: [makePack().concepts[0]!], relations: [], syllabus: makePack().syllabus, sections: makePack().sections });
    const service = serviceFor(makePack(), other);
    expect((await service.listConcepts("OTHER_EXAM")).map((c) => c.key)).toEqual(["a"]);
    expect((await service.listConcepts("TEST_EXAM")).length).toBe(5);
  });
});

describe("provenance / validation-state summary", () => {
  it("reports an unreviewed pack as unreviewed - never rounded up", () => {
    const summary = summarizePackValidationState(makePack());
    expect(summary.byReviewState.reviewed).toBe(0);
    expect(summary.byReviewState.unvalidated).toBe(summary.total);
    expect(summary.byKind.authored).toBe(summary.total);
  });

  it("counts reviewed and inferred artifacts separately", () => {
    const pack = makePack({
      provenance: prov({ kind: "canonical", reviewState: "reviewed", reviewedBy: "editor" }),
      relations: [...makePack().relations, relation("a", "d", "directly_related", { source: "ai_suggested", provenance: prov({ kind: "inferred" }) })]
    });
    const summary = summarizePackValidationState(pack);
    expect(summary.byReviewState.reviewed).toBe(1);
    expect(summary.byKind.canonical).toBe(1);
    expect(summary.byKind.inferred).toBe(1);
  });
});

describe("public (student-safe) view", () => {
  const view = toPublicExamPackView(makePack({ provenance: prov({ note: "INTERNAL-NOTE" }) }));
  const json = JSON.stringify(view);

  it("contains structure and names", () => {
    expect(view.examName).toBe("Test Exam");
    expect(view.sections.map((s) => s.name)).toEqual(["Section One", "Section Two"]);
    expect(view.relations.find((r) => r.type === "prerequisite")).toEqual({ from: "a", to: "b", type: "prerequisite" });
  });

  it("never exposes provenance, review state, certainty, source, status, keys, notes or rationale", () => {
    for (const forbidden of ["provenance", "sourceRef", "reviewState", "reviewedBy", "licenseRef", "certainty", "rationale", "sharedKnowledge", "status", "INTERNAL-NOTE", "test fixture", "key", "examCode", "packVersion"]) {
      expect(json).not.toContain(forbidden);
    }
  });

  it("contains no student-state vocabulary (an exam knowledge space says nothing about a student)", () => {
    for (const forbidden of ["mastery", "mastered", "confidence", "studentId", "score"]) {
      expect(json.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });
});
