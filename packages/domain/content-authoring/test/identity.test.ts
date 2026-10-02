import { describe, expect, it } from "vitest";
import { AuthoringConflictError, computeContentFingerprint, createDraft, editQuestion, InMemoryQuestionAuthoringRepository, normalizeForFingerprint } from "../src/index.js";
import { baseDna, baseInput } from "./fixtures.js";

const fp = (body: string, options: string[] = ["a", "b"], exam = "IPMAT_INDORE") => computeContentFingerprint(exam, body, options);

describe("content fingerprint - 'the same question typed twice', never 'a similar question'", () => {
  it("ignores case, whitespace, punctuation and option order", () => {
    expect(fp("What is 5% of 200?", ["10", "20"])).toBe(fp("  what IS 5%   of 200 ", ["20", "10"]));
  });
  it("keeps digits and numeric symbols: different numbers are different questions", () => {
    expect(fp("What is 5% of 200?")).not.toBe(fp("What is 6% of 200?"));
    expect(fp("Change of -5.5 points")).not.toBe(fp("Change of 5.5 points"));
  });
  it("different options are a different question", () => {
    expect(fp("Same stem here.", ["1", "2"])).not.toBe(fp("Same stem here.", ["1", "3"]));
  });
  it("is scoped to the exam: the same words in another exam are another question", () => {
    expect(fp("Same stem.", ["1"], "A")).not.toBe(fp("Same stem.", ["1"], "B"));
  });
  it("is deterministic and a sha256 hex digest", () => {
    expect(fp("x")).toBe(fp("x"));
    expect(fp("x")).toMatch(/^[0-9a-f]{64}$/);
  });
  it("normalizes Unicode forms", () => {
    expect(normalizeForFingerprint("ｆｕｌｌｗｉｄｔｈ")).toBe("fullwidth");
  });
});

describe("InMemoryQuestionAuthoringRepository - stable identity", () => {
  it("creates a draft once; the same logical question again returns the EXISTING identity, never a second copy", async () => {
    const repo = new InMemoryQuestionAuthoringRepository();
    expect(await repo.createDraft(createDraft(baseInput("a")))).toEqual({ id: "a", alreadyExisted: false });
    expect(await repo.createDraft(createDraft(baseInput("b")))).toEqual({ id: "a", alreadyExisted: true });
    expect((await repo.listIdentityRefs("IPMAT_INDORE")).map((r) => r.id)).toEqual(["a"]);
  });

  it("does NOT merge a merely similar question", async () => {
    const repo = new InMemoryQuestionAuthoringRepository();
    await repo.createDraft(createDraft(baseInput("a")));
    const similar = baseInput("b");
    similar.content.body = similar.content.body.replace("8,000", "9,000");
    expect(await repo.createDraft(createDraft(similar))).toEqual({ id: "b", alreadyExisted: false });
  });

  it("a rejected question does not block re-authoring the same wording; another exam is independent", async () => {
    const repo = new InMemoryQuestionAuthoringRepository();
    await repo.createDraft(createDraft(baseInput("a")));
    await repo.mutate("a", (q) => ({ ...q, validationState: "rejected" }));
    expect((await repo.createDraft(createDraft(baseInput("b")))).alreadyExisted).toBe(false);
    const other = baseInput("c", { dna: baseDna({ examCode: "OTHER_EXAM" }) });
    expect((await repo.createDraft(createDraft(other))).alreadyExisted).toBe(false);
  });

  it("an id is never reused, never changes and never moves between exams", async () => {
    const repo = new InMemoryQuestionAuthoringRepository();
    await repo.createDraft(createDraft(baseInput("a")));
    const different = baseInput("a");
    different.content.body = "A completely different question body with enough length.";
    await expect(repo.createDraft(createDraft(different))).rejects.toBeInstanceOf(AuthoringConflictError);
    await expect(repo.mutate("a", (q) => ({ ...q, id: "z" }))).rejects.toBeInstanceOf(AuthoringConflictError);
    await expect(repo.mutate("a", (q) => ({ ...q, dna: { ...q.dna, examCode: "OTHER_EXAM" } }))).rejects.toBeInstanceOf(AuthoringConflictError);
  });

  it("editing keeps identity and stays one logical question; a published question's content is immutable", async () => {
    const repo = new InMemoryQuestionAuthoringRepository();
    await repo.createDraft(createDraft(baseInput("a")));
    const edited = await repo.mutate("a", (q) => editQuestion(q, { content: { ...q.content, solutionSteps: ["New step."] } }));
    expect(edited.id).toBe("a");
    expect((await repo.listIdentityRefs("IPMAT_INDORE")).length).toBe(1);
    await repo.mutate("a", (q) => ({ ...q, validationState: "published" }));
    await expect(repo.mutate("a", (q) => ({ ...q, content: { ...q.content, body: "Changed body of a published question, long enough." } }))).rejects.toBeInstanceOf(AuthoringConflictError);
  });

  it("returns copies: mutating a result does not change the store", async () => {
    const repo = new InMemoryQuestionAuthoringRepository();
    await repo.createDraft(createDraft(baseInput("a")));
    const q = (await repo.findById("a"))!;
    q.content.body = "tampered";
    expect((await repo.findById("a"))!.content.body).not.toBe("tampered");
  });

  it("identity refs and universe refs carry NO answer, solution or reviewer data", async () => {
    const repo = new InMemoryQuestionAuthoringRepository();
    await repo.createDraft(createDraft(baseInput("a")));
    const text = JSON.stringify([await repo.listIdentityRefs("IPMAT_INDORE"), await repo.listUniverseRefs("IPMAT_INDORE")]);
    for (const forbidden of ["correctAnswer", "solutionSteps", "groundTruth", "reviewedBy", "notes"]) expect(text).not.toContain(forbidden);
  });
});
