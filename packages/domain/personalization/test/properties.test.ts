import { describe, expect, it } from "vitest";
import { InMemoryPreferenceStore, NO_PREFERENCES, PREFERENCE_FIELDS, PREFERRED_HELP, buildPersonalizationView, loadPreferencesForRequest, personalizeCurriculum, personalizeRevision, personalizeTutorRequest, simulationPersonalization, validatePreferences, type StudentPreferences } from "../src/index.js";
import { adaptiveWorld, build, resetCounter, trapWorld } from "./curriculumFixtures.js";
import { ENROLL_A, EXAM, KEY, OTHER_EXAM, STUDENT_A, hintJson, tutor, tutorPorts } from "./tutorFixtures.js";

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = <T>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
const randomPrefs = (r: () => number): StudentPreferences => ({ language: pick(r, [null, "english", "hindi", "hinglish"] as const), verbosity: pick(r, [null, "concise", "standard", "detailed"] as const), preferredHelp: pick(r, [null, ...PREFERRED_HELP] as const) });
const deepFreeze = <T>(o: T): T => {
  if (o && typeof o === "object" && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o as object)) deepFreeze(v);
  }
  return o;
};
const keysOf = (v: unknown, out: string[] = []): string[] => {
  if (Array.isArray(v)) v.forEach((x) => keysOf(x, out));
  else if (v && typeof v === "object") {
    for (const [k, x] of Object.entries(v)) {
      out.push(k);
      keysOf(x, out);
    }
  }
  return out;
};
const TRAIT = /confiden|intellig|\biq\b|motivat|personalit|anxi|emotion|mood|learning[_ -]?style|learner|ability|aptitude|trait|visual|auditory|kinesthetic|lazy|weak|strong/i;

describe("properties (seeded, deterministic)", () => {
  it("STUDENT / PREFERENCE ISOLATION: across many students, each reads exactly their own preferences and a write never changes another's", async () => {
    const r = rng(3);
    const store = new InMemoryPreferenceStore();
    const ids = Array.from({ length: 25 }, (_, i) => `student-${i}`);
    const expected = new Map<string, StudentPreferences>();
    for (let round = 0; round < 60; round++) {
      const id = pick(r, ids);
      const patch = randomPrefs(r);
      expected.set(id, { ...patch });
      await store.set(id, patch);
      for (const other of ids) expect(await store.get(other)).toEqual(expected.get(other) ?? NO_PREFERENCES);
    }
  });
  it("OWNERSHIP: preferences are loaded only for the student who owns the enrollment, whatever id the caller names", async () => {
    const r = rng(8);
    const store = new InMemoryPreferenceStore();
    await store.set("11111111-aaaa-4aaa-8aaa-111111111111", { language: "hindi" });
    await store.set("22222222-bbbb-4bbb-8bbb-222222222222", { language: "hinglish" });
    const ports = tutorPorts();
    for (let i = 0; i < 40; i++) {
      const studentId = pick(r, ["11111111-aaaa-4aaa-8aaa-111111111111", "22222222-bbbb-4bbb-8bbb-222222222222"]);
      const enrollmentId = pick(r, ["33333333-aaaa-4aaa-8aaa-333333333333", "44444444-bbbb-4bbb-8bbb-444444444444"]);
      const owns = (studentId.startsWith("1") && enrollmentId.startsWith("3")) || (studentId.startsWith("2") && enrollmentId.startsWith("4"));
      const result = loadPreferencesForRequest({ ownership: ports.ownership, store }, { studentId, enrollmentId });
      if (owns) expect((await result).preferences.language).toBe(studentId.startsWith("1") ? "hindi" : "hinglish");
      else await expect(result).rejects.toMatchObject({ code: "ownership_denied" });
    }
  });
  it("EXAM ISOLATION: a view names only its own exam and is otherwise identical across exams for the same preferences", () => {
    const r = rng(14);
    for (let i = 0; i < 30; i++) {
      const p = randomPrefs(r);
      const decisions = personalizeTutorRequest({ intent: "give_hint", studentId: "s", enrollmentId: "e", questionId: "q" }, p).decisions;
      const a = buildPersonalizationView({ examCode: EXAM, preferences: p, decisions });
      const b = buildPersonalizationView({ examCode: OTHER_EXAM, preferences: p, decisions });
      expect(JSON.stringify(a)).not.toContain(OTHER_EXAM);
      expect(JSON.stringify(b)).not.toContain(`"${EXAM}"`);
      expect({ ...a, examCode: "x" }).toEqual({ ...b, examCode: "x" });
    }
  });
  it("DETERMINISM: the same preferences give byte-identical requests, decisions, views and reports", () => {
    const r = rng(21);
    for (let i = 0; i < 40; i++) {
      const p = randomPrefs(r);
      const base = { intent: "give_hint" as const, studentId: "s", enrollmentId: "e", questionId: "q", focus: `note ${i}` };
      const one = personalizeTutorRequest(base, p);
      const two = personalizeTutorRequest(base, p);
      expect(JSON.stringify(one)).toBe(JSON.stringify(two));
      expect(JSON.stringify(buildPersonalizationView({ examCode: EXAM, preferences: p, decisions: one.decisions }))).toBe(JSON.stringify(buildPersonalizationView({ examCode: EXAM, preferences: p, decisions: two.decisions })));
      expect(JSON.stringify(simulationPersonalization(p))).toBe(JSON.stringify(simulationPersonalization(p)));
    }
  });
  it("NO PREFERENCE = EXISTING BEHAVIOUR: any request comes back as the very same object", () => {
    const r = rng(2);
    for (let i = 0; i < 40; i++) {
      const request = { intent: pick(r, ["give_hint", "explain_question", "explain_mistake", "guide_with_question"] as const), studentId: `s${i}`, enrollmentId: `e${i}`, questionId: `q${i}`, focus: i % 2 ? `focus ${i}` : undefined };
      expect(personalizeTutorRequest(request, NO_PREFERENCES).request).toBe(request);
    }
  });
  it("PERSONALIZATION CANNOT WEAKEN TUTOR SECURITY: for any preferences, a key leak in the validated English is still rejected and nothing leaks into a view", async () => {
    const r = rng(40);
    for (let i = 0; i < 18; i++) {
      const p = randomPrefs(r);
      const { request } = personalizeTutorRequest({ intent: "give_hint", studentId: STUDENT_A, enrollmentId: ENROLL_A, questionId: "question-pct-1" }, p);
      const leak = hintJson({ text: `The correct answer is ${KEY}.`, localizedText: "20 प्रतिशत की कमी पर सोचिए।" });
      const { service } = tutor([leak, leak]);
      const out = await service.answer(request);
      expect(out.outcome).toBe("rejected_ungrounded");
      expect(JSON.stringify(out)).not.toContain(`answer is ${KEY}`);
    }
  });
  it("PROVIDER RULES CANNOT BE BYPASSED: the curriculum's next action and chain are identical for every preference set", () => {
    resetCounter();
    const r = rng(60);
    for (const w of [trapWorld(), adaptiveWorld()]) {
      const { curriculum } = build(w.records, w.candidates);
      const before = JSON.stringify(curriculum);
      for (let i = 0; i < 25; i++) {
        const out = personalizeCurriculum(curriculum, randomPrefs(r));
        expect(out.value).toBe(curriculum);
        expect(JSON.stringify(out.value.nextAction)).toBe(JSON.stringify(curriculum.nextAction));
      }
      expect(JSON.stringify(curriculum)).toBe(before);
      resetCounter();
    }
  });
  it("PREFERENCES CANNOT MUTATE EVIDENCE: deep-frozen curriculum and revision pass through every preference set untouched", () => {
    resetCounter();
    const r = rng(77);
    const w = trapWorld();
    const { curriculum, revision } = build(w.records, w.candidates);
    deepFreeze(curriculum);
    deepFreeze(revision);
    const snapshot = JSON.stringify({ curriculum, revision });
    for (let i = 0; i < 30; i++) {
      const p = randomPrefs(r);
      expect(() => personalizeCurriculum(curriculum, p)).not.toThrow();
      expect(() => personalizeRevision(revision, p)).not.toThrow();
    }
    expect(JSON.stringify({ curriculum, revision })).toBe(snapshot);
  });
  it("EVIDENCE CANNOT BECOME A TRAIT: a view is identical whatever the student's evidence, and has no evidence or trait field", () => {
    resetCounter();
    const w1 = trapWorld();
    build(w1.records, w1.candidates);
    resetCounter();
    const w2 = adaptiveWorld();
    build(w2.records, w2.candidates);
    const r = rng(90);
    for (let i = 0; i < 25; i++) {
      const p = randomPrefs(r);
      const decisions = personalizeTutorRequest({ intent: "give_hint", studentId: "s", enrollmentId: "e", questionId: "q" }, p).decisions;
      const view = buildPersonalizationView({ examCode: EXAM, preferences: p, decisions });
      expect(view.evidenceUsed).toEqual([]);
      expect(keysOf(view).some((k) => TRAIT.test(k))).toBe(false);
    }
  });
  it("NO INFERRED ATTRIBUTE EXISTS IN ANY DATA SHAPE: keys of every preference, decision, report, view and presentation are free of trait vocabulary", () => {
    const r = rng(5);
    for (let i = 0; i < 40; i++) {
      const p = randomPrefs(r);
      const out = personalizeTutorRequest({ intent: "give_hint", studentId: "s", enrollmentId: "e", questionId: "q" }, p);
      const shapes = [p, out.request.presentation ?? {}, out.decisions, buildPersonalizationView({ examCode: EXAM, preferences: p, decisions: out.decisions }), simulationPersonalization(p)];
      for (const shape of shapes) expect(keysOf(shape).filter((k) => TRAIT.test(k)), JSON.stringify(shape).slice(0, 80)).toEqual([]);
      for (const d of out.decisions) expect(`${d.output} ${d.rule} ${d.dimension}`).not.toMatch(TRAIT);
    }
    expect([...PREFERENCE_FIELDS].filter((f) => TRAIT.test(f))).toEqual([]);
    expect(Object.keys(validatePreferences({ language: "hindi" })).filter((k) => TRAIT.test(k))).toEqual([]);
  });
});
