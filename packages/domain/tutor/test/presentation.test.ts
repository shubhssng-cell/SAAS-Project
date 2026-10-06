import { describe, expect, it } from "vitest";
import { TUTOR_LANGUAGES, TUTOR_VERBOSITIES, TUTOR_INTENTS, buildTutorContext, buildTutorUserPrompt, toStudentTutorView, tutorPromptVersion, TUTOR_PROMPT_VERSION, type TutorLanguage, type TutorPresentation, type TutorRequest, type TutorVerbosity } from "../src/index.js";
import { KEY, STEP_1, TRAP_CODE, build, contractParts, modelFor, ports, request, world } from "./fixtures.js";

const hint = (presentation?: TutorPresentation, over: Partial<TutorRequest> = {}): TutorRequest => request({ intent: "give_hint", ...(presentation ? { presentation } : {}), ...over });
const HINDI: TutorPresentation = { language: "hindi", verbosity: "standard" };
const HINGLISH: TutorPresentation = { language: "hinglish", verbosity: "standard" };
const EN_HINT = "Think about what multiplier a 20 percent decrease gives.";
const HI_OK = "20 प्रतिशत की कमी किस गुणक के बराबर होती है, इस पर सोचिए।";
const HG_OK = "Socho ki 20 percent ki kami kaun sa multiplier deti hai.";
const hintOut = (localizedText?: string, over: Record<string, unknown> = {}) => modelFor("give_hint", { text: EN_HINT, ...(localizedText === undefined ? {} : { localizedText }), ...over });

describe("default presentation: the pre-Unit-4 behaviour, exactly", () => {
  it("an absent presentation and an explicit default give a byte-identical prompt, prompt version and context", async () => {
    const a = await buildTutorContext(ports(), hint());
    const b = await buildTutorContext(ports(), hint({ language: "english", verbosity: "standard" }));
    if (a.kind !== "context" || b.kind !== "context") throw new Error("ctx");
    expect(buildTutorUserPrompt(a.context)).toBe(buildTutorUserPrompt(b.context));
    expect(a.context).toEqual(b.context);
    expect(tutorPromptVersion(a.context.presentation)).toBe(TUTOR_PROMPT_VERSION);
    expect(buildTutorUserPrompt(a.context)).not.toContain("PRESENTATION");
  });
  it("the response records the default presentation, has no localized text, and the view says English", async () => {
    const { service, audits } = build([hintOut()]);
    const r = await service.answer(hint());
    expect(r.outcome).toBe("answered");
    expect(r.presentation).toEqual({ language: "english", verbosity: "standard" });
    expect(r.localizedText).toBeNull();
    expect(r.grounding.localization).toEqual({ requested: "english", status: "not_requested", codes: [] });
    expect(toStudentTutorView(r).language).toBe("english");
    expect(audits[0]!.model!.promptVersion).toBe("tutor-response-v2");
  });
  it("a localizedText the model volunteers for an English request is ignored, never shown", async () => {
    const { service } = build([hintOut(HI_OK)]);
    const r = await service.answer(hint());
    expect(r.localizedText).toBeNull();
    expect(toStudentTutorView(r).message).toBe(EN_HINT);
  });
});

describe("presentation is validated strictly", () => {
  it.each([
    [{ language: "klingon" }, "invalid_request"],
    [{ verbosity: "verbose" }, "invalid_request"],
    [{ language: "hindi", confidence: "low" }, "invalid_request"],
    [{ language: "hindi", learningStyle: "visual" }, "invalid_request"],
    ["hindi", "invalid_request"],
    [[], "invalid_request"],
    [null, "invalid_request"]
  ])("rejects %j", async (bad, code) => {
    await expect(buildTutorContext(ports(), { ...hint(), presentation: bad as never })).rejects.toMatchObject({ code });
  });
  it("accepts every supported combination", async () => {
    for (const language of TUTOR_LANGUAGES) for (const verbosity of TUTOR_VERBOSITIES) {
      const b = await buildTutorContext(ports(), hint({ language, verbosity }));
      expect(b.kind).toBe("context");
    }
  });
});

describe("presentation never changes disclosure, scope or context", () => {
  it.each(TUTOR_INTENTS)("%s: key, included/withheld sections, protected key and refs are identical for every presentation", async (intent) => {
    const base = await buildTutorContext(ports(), request({ intent, conceptName: "Percentages" }));
    if (base.kind !== "context") return;
    for (const language of TUTOR_LANGUAGES) for (const verbosity of TUTOR_VERBOSITIES) {
      const b = await buildTutorContext(ports(), { ...request({ intent, conceptName: "Percentages" }), presentation: { language, verbosity } });
      if (b.kind !== "context") throw new Error("ctx");
      expect(b.context.answerKey).toEqual(base.context.answerKey);
      expect(b.context.includedSections).toEqual(base.context.includedSections);
      expect(b.context.withheldSections).toEqual(base.context.withheldSections);
      expect(b.context.refs).toEqual(base.context.refs);
      expect(b.protectedKey).toEqual(base.protectedKey);
      expect(b.internalTokens).toEqual(base.internalTokens);
      const prompt = buildTutorUserPrompt(b.context);
      if (!b.context.answerKey) expect(prompt).not.toContain("AUTHORED KEY");
      expect(prompt).not.toContain(TRAP_CODE);
    }
  });
  it("a non-default presentation changes the prompt only by its PRESENTATION block, and names its own prompt version", async () => {
    const a = await buildTutorContext(ports(), hint());
    const b = await buildTutorContext(ports(), hint({ language: "hinglish", verbosity: "concise" }));
    if (a.kind !== "context" || b.kind !== "context") throw new Error("ctx");
    const pa = buildTutorUserPrompt(a.context);
    const pb = buildTutorUserPrompt(b.context);
    expect(pb.startsWith(pa)).toBe(true);
    expect(pb.slice(pa.length)).toContain("PRESENTATION");
    expect(pb).toContain("localizedText");
    expect(pb).toContain("does not change what you may reveal");
    expect(tutorPromptVersion(b.context.presentation)).toBe("tutor-response-v3");
  });
});

describe("localized text: an add-on, validated on its own, droppable", () => {
  const run = async (localizedText: string | undefined, presentation: TutorPresentation, over: Record<string, unknown> = {}) => {
    const { service, audits } = build([hintOut(localizedText, over)]);
    const r = await service.answer(hint(presentation));
    return { r, audits, view: toStudentTutorView(r) };
  };

  it("valid Hindi (Devanagari) is shown, labelled, and the English stays the validated canonical text", async () => {
    const { r, view } = await run(HI_OK, HINDI);
    expect(r.outcome).toBe("answered");
    expect(r.grounding.localization.status).toBe("validated");
    expect(r.text).toBe(EN_HINT);
    expect(r.localizedText).toBe(HI_OK);
    expect(view.message).toBe(HI_OK);
    expect(view.language).toBe("hindi");
  });
  it("valid Hinglish (Roman script) is shown", async () => {
    const { r, view } = await run(HG_OK, HINGLISH);
    expect(r.grounding.localization.status).toBe("validated");
    expect(view.message).toBe(HG_OK);
    expect(view.language).toBe("hinglish");
  });
  it.each([
    ["Hindi requested but Latin script returned", "Think about the multiplier of a twenty percent fall.", HINDI, "wrong_script"],
    ["Hinglish requested but Devanagari returned", HI_OK, HINGLISH, "wrong_script"],
    ["the withheld key as a whole token (Hindi, no verdict word needed)", `उत्तर ${KEY} है, 20 प्रतिशत।`, HINDI, "localized_key_token"],
    ["the withheld key in Hinglish", `${KEY} chuniye, 20 percent.`, HINGLISH, "localized_key_token"],
    ["a figure that is nowhere in the context", "20 प्रतिशत और 37 पर सोचिए।", HINDI, "localized_number_not_in_context"],
    ["an authored solution step", `${STEP_1} 20`, HINGLISH, "localized_solution_leak"],
    ["an internal identifier", "20 प्रतिशत 99999999-9999-4999-8999-999999999999", HINDI, "localized_identifier"],
    ["a Hindi psychological claim", "आप कमजोर हैं, 20 प्रतिशत पर सोचिए।", HINDI, "localized_psychological_claim"],
    ["a Hinglish psychological claim", "Aap kamzor hain, 20 percent par socho.", HINGLISH, "localized_psychological_claim"],
    ["an English loanword psychological claim in Hinglish", "Aapme confidence ki kami hai, 20 percent.", HINGLISH, "localized_psychological_claim"],
    ["a Hinglish readiness claim", "Aap exam ke liye tayyar hain, 20 percent.", HINGLISH, "localized_mastery_readiness_claim"],
    ["a Hindi readiness claim", "आप परीक्षा के लिए तैयार हैं, 20 प्रतिशत।", HINDI, "localized_mastery_readiness_claim"],
    ["an exam rule no source states", "Negative marking hoti hai, 20 percent.", HINGLISH, "localized_exam_rule"]
  ])("rejects %s: the localized text is DROPPED, the validated English is shown", async (_n, localized, presentation, code) => {
    const { r, view } = await run(localized, presentation);
    expect(r.outcome).toBe("answered"); // the English was clean
    expect(r.grounding.localization.status).toBe("rejected");
    expect(r.grounding.localization.codes).toContain(code);
    expect(r.localizedText).toBeNull();
    expect(view.message).toBe(EN_HINT);
    expect(view.language).toBe("english");
    expect(JSON.stringify(view)).not.toContain(localized);
  });
  it("a missing localized text falls back to English (answered, status missing)", async () => {
    const { r, view } = await run(undefined, HINDI);
    expect(r.outcome).toBe("answered");
    expect(r.grounding.localization).toEqual({ requested: "hindi", status: "missing", codes: ["localized_text_missing"] });
    expect(view.language).toBe("english");
  });
  it("an insufficient_context answer needs no localized text", async () => {
    const { service } = build([modelFor("give_hint", { responseType: "insufficient_context", text: "I can't ground a hint here.", citations: [], missingContext: ["x"] })]);
    const r = await service.answer(hint(HINDI));
    expect(r.outcome).toBe("insufficient_context");
    expect(r.grounding.localization.codes).toEqual([]);
  });
  it("a good localized text never rescues a bad English one: an English key leak is still rejected for every language", async () => {
    for (const presentation of [HINDI, HINGLISH]) {
      const bad = hintOut(presentation === HINDI ? HI_OK : HG_OK, { text: `The correct answer is ${KEY}.` });
      const { service } = build([bad, bad]);
      const r = await service.answer(hint(presentation));
      expect(r.outcome).toBe("rejected_ungrounded");
      expect(r.text).toBeNull();
      expect(r.localizedText).toBeNull();
      expect(r.grounding.violations.map((v) => v.code)).toContain("answer_key_leakage");
    }
  });
  it("authorized disclosure is unchanged by language: with a submitted attempt the keyed number may appear in the translation", async () => {
    const raw = modelFor("explain_mistake", { text: `Your submitted answer was ₹480, while the keyed answer is ${KEY}.`, localizedText: `आपका उत्तर ₹480 था, जबकि सही उत्तर ${KEY} है।`, hypotheses: [] });
    const { service } = build([raw]);
    const r = await service.answer(request({ intent: "explain_mistake", presentation: HINDI }));
    expect(r.outcome).toBe("answered");
    expect(r.grounding.localization.status).toBe("validated");
    expect(r.teachingAction.answerDisclosure).toBe("authorized");
  });
  it("only the main message is localized: the structured parts and question stay English in the view", async () => {
    const { service } = build([modelFor("guide_with_question", { localizedText: "20 प्रतिशत की कमी के बाद मूल्य का कौन सा अंश बचता है?" })]);
    const r = await service.answer(request({ intent: "guide_with_question", presentation: HINDI }));
    const view = toStudentTutorView(r);
    expect(r.outcome).toBe("answered");
    expect(view.language).toBe("hindi");
    expect(view.question).toContain("What fraction");
  });
});

describe("verbosity", () => {
  const concept = (v: TutorVerbosity, partsExtra: Record<string, unknown> = {}) => modelFor("explain_concept", { parts: { ...(contractParts("explain_concept", false) as object), ...partsExtra } });
  const req = (verbosity: TutorVerbosity) => request({ intent: "explain_concept", conceptName: "Percentages", presentation: { language: "english", verbosity } });

  it("concise forbids the optional parts: the response is regenerated and the second, required-only answer is accepted", async () => {
    const { service, provider } = build([concept("concise", { tryNext: "Try a reverse percentage question." }), concept("concise")]);
    const r = await service.answer(req("concise"));
    expect(r.outcome).toBe("answered");
    expect(provider.prompts).toHaveLength(2);
    expect(provider.prompts[1]!.userPrompt).toContain("verbosity_violation");
    expect(r.parts).toEqual(contractParts("explain_concept", false));
  });
  it("concise never drops a REQUIRED part (that is still a missing part)", async () => {
    const { service } = build([modelFor("explain_concept", { parts: { concept: "A percentage is per hundred." } }), modelFor("explain_concept", { parts: { concept: "A percentage is per hundred." } })]);
    const r = await service.answer(req("concise"));
    expect(r.outcome).toBe("rejected_ungrounded");
    expect(r.grounding.violations.map((v) => v.code)).toContain("missing_explanation_part");
  });
  it("detailed may include the optional part, within the same rules; standard is unchanged", async () => {
    for (const v of ["detailed", "standard"] as const) {
      const { service } = build([concept(v, { tryNext: "Try a reverse percentage question." })]);
      expect((await service.answer(req(v))).outcome).toBe("answered");
    }
  });
  it("concise does not shorten or weaken anything checked elsewhere: a key assertion is still rejected", async () => {
    const bad = modelFor("give_hint", { text: `The correct answer is ${KEY}.` });
    const { service } = build([bad, bad]);
    const r = await service.answer(hint({ language: "english", verbosity: "concise" }));
    expect(r.outcome).toBe("rejected_ungrounded");
  });
  it("detailed cannot exceed the existing caps (a hint is still capped)", async () => {
    const long = modelFor("give_hint", { text: "Think about the multiplier. ".repeat(40) });
    const { service } = build([long, long]);
    const r = await service.answer(hint({ language: "english", verbosity: "detailed" }));
    expect(r.outcome).toBe("rejected_ungrounded");
    expect(r.grounding.violations.map((v) => v.code)).toContain("response_too_long");
  });
});

describe("presentation exercises every language x verbosity without touching ownership or scope", () => {
  it("another student's enrollment is refused whatever the presentation, before any model call", async () => {
    for (const language of TUTOR_LANGUAGES as readonly TutorLanguage[]) {
      const { service, provider } = build([]);
      await expect(service.answer({ ...hint({ language, verbosity: "concise" }), enrollmentId: "44444444-bbbb-4bbb-8bbb-444444444444" })).rejects.toMatchObject({ code: "ownership_denied" });
      expect(provider.prompts).toHaveLength(0);
    }
    expect(world()).toBeTruthy();
  });
});
