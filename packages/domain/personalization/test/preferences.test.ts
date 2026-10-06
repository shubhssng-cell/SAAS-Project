import { describe, expect, it } from "vitest";
import { INFERRED_ATTRIBUTE_PATTERN, InMemoryPreferenceStore, NO_PREFERENCES, PREFERENCE_FIELDS, PreferenceError, applyPreferencePatch, validatePreferencePatch, validatePreferences } from "../src/index.js";
import { STUDENT_A, STUDENT_B } from "./tutorFixtures.js";

const code = (f: () => unknown): string => {
  try {
    f();
    return "no error";
  } catch (e) {
    return e instanceof PreferenceError ? e.code : `other:${String(e)}`;
  }
};

describe("preferences: a minimal explicit contract", () => {
  it("has exactly three explicit fields, every default is 'no preference' (null)", () => {
    expect([...PREFERENCE_FIELDS]).toEqual(["language", "verbosity", "preferredHelp"]);
    expect(NO_PREFERENCES).toEqual({ language: null, verbosity: null, preferredHelp: null });
    expect(Object.isFrozen(NO_PREFERENCES)).toBe(true);
    expect(validatePreferences({})).toEqual(NO_PREFERENCES);
  });
  it.each([
    [{ language: "hindi" }, { language: "hindi", verbosity: null, preferredHelp: null }],
    [{ language: "hinglish", verbosity: "concise" }, { language: "hinglish", verbosity: "concise", preferredHelp: null }],
    [{ language: "english", verbosity: "detailed", preferredHelp: "guided_question" }, { language: "english", verbosity: "detailed", preferredHelp: "guided_question" }],
    [{ preferredHelp: "hint" }, { language: null, verbosity: null, preferredHelp: "hint" }],
    [{ language: null }, NO_PREFERENCES]
  ])("accepts %j", (input, expected) => {
    expect(validatePreferences(input)).toEqual(expected);
  });
  it.each([
    [{ language: "klingon" }, "invalid_value"],
    [{ verbosity: "verbose" }, "invalid_value"],
    [{ preferredHelp: "solution" }, "invalid_value"],
    [{ language: 3 }, "invalid_value"],
    [{ language: "" }, "invalid_value"],
    ["hindi", "invalid_input"],
    [null, "invalid_input"],
    [[], "invalid_input"],
    [{ pace: "fast" }, "unsupported_field"],
    [{ theme: "dark" }, "unsupported_field"]
  ])("refuses %j with %s", (input, expected) => {
    expect(code(() => validatePreferences(input))).toBe(expected);
  });
  it("refuses every trait, feeling, ability or style by name - a distinct 'inferred attribute' refusal", () => {
    const traits = ["confidence", "intelligence", "iq", "motivation", "personality", "anxiety", "emotionalState", "mood", "feeling", "learningStyle", "learning_style", "learnerType", "visualLearner", "auditory", "kinesthetic", "ability", "aptitude", "talent", "laziness", "weakness", "strength", "skillLevel", "studentScore", "rank", "profile", "traits"];
    for (const trait of traits) {
      expect(code(() => validatePreferences({ [trait]: "high" })), trait).toBe("inferred_attribute_not_allowed");
      expect(code(() => validatePreferences({ language: "hindi", [trait]: 1 })), `${trait} alongside a valid field`).toBe("inferred_attribute_not_allowed");
    }
    expect(INFERRED_ATTRIBUTE_PATTERN.test("language")).toBe(false);
    expect(INFERRED_ATTRIBUTE_PATTERN.test("verbosity")).toBe(false);
  });
  it("a patch changes only the fields it names, and null clears one", () => {
    const start = validatePreferences({ language: "hindi", verbosity: "concise" });
    expect(applyPreferencePatch(start, { verbosity: "detailed" })).toEqual({ language: "hindi", verbosity: "detailed", preferredHelp: null });
    expect(applyPreferencePatch(start, { language: null })).toEqual({ language: null, verbosity: "concise", preferredHelp: null });
    expect(applyPreferencePatch(start, {})).toEqual(start);
    expect(validatePreferencePatch({ language: "hindi" })).toEqual({ language: "hindi" }); // a patch never invents the fields it does not mention
  });
});

describe("the preference store: per student, validated, nothing else stored", () => {
  it("returns 'no preference' by default and persists changes", async () => {
    const store = new InMemoryPreferenceStore();
    expect(await store.get(STUDENT_A)).toEqual(NO_PREFERENCES);
    expect(await store.set(STUDENT_A, { language: "hinglish" })).toEqual({ language: "hinglish", verbosity: null, preferredHelp: null });
    expect(await store.set(STUDENT_A, { verbosity: "concise" })).toEqual({ language: "hinglish", verbosity: "concise", preferredHelp: null });
    expect(await store.get(STUDENT_A)).toEqual({ language: "hinglish", verbosity: "concise", preferredHelp: null });
    expect(await store.set(STUDENT_A, { language: null })).toEqual({ language: null, verbosity: "concise", preferredHelp: null });
  });
  it("one student's preferences are unreachable through another's, and a returned value cannot mutate the store", async () => {
    const store = new InMemoryPreferenceStore();
    await store.set(STUDENT_A, { language: "hindi", preferredHelp: "hint" });
    expect(await store.get(STUDENT_B)).toEqual(NO_PREFERENCES);
    const got = await store.get(STUDENT_A);
    (got as { language: string | null }).language = "english";
    expect((await store.get(STUDENT_A)).language).toBe("hindi");
    await store.set(STUDENT_B, { language: "hinglish" });
    expect((await store.get(STUDENT_A)).language).toBe("hindi");
  });
  it("a refused write leaves the stored value untouched, and a stored record has only the three explicit fields", async () => {
    const store = new InMemoryPreferenceStore();
    await store.set(STUDENT_A, { language: "hindi" });
    await expect(store.set(STUDENT_A, { language: "english", confidence: "low" })).rejects.toBeInstanceOf(PreferenceError);
    await expect(store.set(STUDENT_A, { language: "klingon" })).rejects.toBeInstanceOf(PreferenceError);
    expect(await store.get(STUDENT_A)).toEqual({ language: "hindi", verbosity: null, preferredHelp: null });
    expect(Object.keys(await store.get(STUDENT_A)).sort()).toEqual([...PREFERENCE_FIELDS].sort());
    await expect(store.set("", { language: "hindi" })).rejects.toBeInstanceOf(PreferenceError);
  });
});
