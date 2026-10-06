import { TUTOR_LANGUAGES, TUTOR_VERBOSITIES, type TutorLanguage, type TutorVerbosity } from "@ipmat/tutor";

/**
 * EXPLICIT PREFERENCES (Phase 8 Unit 4, docs/DECISIONS.md D-095).
 *
 * The repository had NO preference model (docs/project-memory/20_STUDENT_MODEL.md: "no profile, no
 * self-reported data, no preferences"; `Student` has no such column), so this is the minimal explicit
 * contract the unit needs - three fields, each a student's own choice, each governing exactly one
 * presentation rule. Every field is nullable: `null` means "the student has stated no preference" and
 * the pre-existing behaviour applies unchanged.
 *
 * What this is NOT: a profile, a learner type or a score. There is no field for an ability, a feeling,
 * a trait or a style, validation REFUSES any such key by name, and a preference is never derived from
 * evidence - only the student can set one. Four kinds of information stay separate throughout the
 * system: an explicit preference (this file), observable training evidence (attempts), a derived
 * training signal (the existing revision / autopsy / adaptive outputs), and a psychological or latent
 * attribute, which is NEVER inferred, stored or output.
 */
export const PREFERRED_HELP = ["hint", "guided_question", "explanation"] as const;
export type PreferredHelp = (typeof PREFERRED_HELP)[number];

export interface StudentPreferences {
  /** The language of the tutor's answer. The English answer remains the validated canonical one. */
  language: TutorLanguage | null;
  /** How long the tutor's answer is. Never what it may reveal. */
  verbosity: TutorVerbosity | null;
  /** Which kind of tutor help to start with when the student asks for "help" without naming one. */
  preferredHelp: PreferredHelp | null;
}

export const PREFERENCE_FIELDS = ["language", "verbosity", "preferredHelp"] as const satisfies ReadonlyArray<keyof StudentPreferences>;

export const NO_PREFERENCES: Readonly<StudentPreferences> = Object.freeze({ language: null, verbosity: null, preferredHelp: null });

export type PreferenceErrorCode = "invalid_input" | "unsupported_field" | "inferred_attribute_not_allowed" | "invalid_value";

export class PreferenceError extends Error {
  constructor(readonly code: PreferenceErrorCode, message: string) {
    super(message);
    this.name = "PreferenceError";
  }
}

/**
 * Names that describe a person rather than a choice. Refused by name so that the refusal is explicit
 * ("inferred attribute"), distinct from an ordinary unknown field - and so that no future caller can
 * persist a trait by calling it a preference.
 */
export const INFERRED_ATTRIBUTE_PATTERN = /confiden|intellig|\biq\b|motivat|personalit|anxi|emotion|mood|feel|learning[_ -]?style|learner[_ -]?type|\bstyle\b|ability|aptitude|talent|lazy|lazi|stress|nervous|careless|smart|weak|strong|strength|weakness|visual|auditory|kinesthetic|score|level|grade|rank|trait|profile|type\b/i;

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/**
 * Validates a PARTIAL set of preferences (a patch): a missing field is simply not mentioned; an explicit
 * `null` clears a preference. Anything that is not one of the three fields is refused, so a stored
 * preference record can only ever contain these three explicit choices.
 */
export function validatePreferencePatch(input: unknown): Partial<StudentPreferences> {
  if (!isRecord(input)) throw new PreferenceError("invalid_input", "preferences must be an object");
  const out: Partial<StudentPreferences> = {};
  for (const key of Object.keys(input)) {
    if (!(PREFERENCE_FIELDS as readonly string[]).includes(key)) {
      throw new PreferenceError(INFERRED_ATTRIBUTE_PATTERN.test(key) ? "inferred_attribute_not_allowed" : "unsupported_field", INFERRED_ATTRIBUTE_PATTERN.test(key) ? `"${key}" describes the student, not a choice; the system does not store or infer such attributes` : `"${key}" is not a supported preference`);
    }
  }
  const check = <T extends string>(field: keyof StudentPreferences, allowed: readonly T[]): T | null | undefined => {
    if (!(field in input)) return undefined;
    const v = input[field];
    if (v === null) return null;
    if (typeof v !== "string" || !(allowed as readonly string[]).includes(v)) throw new PreferenceError("invalid_value", `"${String(v).slice(0, 40)}" is not a supported value for ${field}`);
    return v as T;
  };
  const language = check("language", TUTOR_LANGUAGES);
  const verbosity = check("verbosity", TUTOR_VERBOSITIES);
  const preferredHelp = check("preferredHelp", PREFERRED_HELP);
  if (language !== undefined) out.language = language;
  if (verbosity !== undefined) out.verbosity = verbosity;
  if (preferredHelp !== undefined) out.preferredHelp = preferredHelp;
  return out;
}

/** A complete, validated preference set: unmentioned fields are `null` (no preference). */
export function validatePreferences(input: unknown): StudentPreferences {
  return { ...NO_PREFERENCES, ...validatePreferencePatch(input) };
}

export function applyPreferencePatch(current: StudentPreferences, patch: unknown): StudentPreferences {
  return { ...current, ...validatePreferencePatch(patch) };
}

/**
 * Where preferences live. Keyed STRICTLY by the student id the caller has already verified; there is no
 * "list" or "find by value", so one student's preferences are unreachable through another's. No durable
 * implementation exists in this unit (D-095): nothing in the product can set a preference yet (no route
 * or settings screen), so a table would be storage without a writer. The in-memory implementation is the
 * test double and the reference for the contract a persistent one must satisfy.
 */
export interface PreferenceStore {
  get(studentId: string): Promise<StudentPreferences>;
  set(studentId: string, patch: unknown): Promise<StudentPreferences>;
}

export class InMemoryPreferenceStore implements PreferenceStore {
  private readonly rows = new Map<string, StudentPreferences>();

  async get(studentId: string): Promise<StudentPreferences> {
    return { ...(this.rows.get(studentId) ?? NO_PREFERENCES) };
  }

  async set(studentId: string, patch: unknown): Promise<StudentPreferences> {
    if (typeof studentId !== "string" || studentId.trim() === "") throw new PreferenceError("invalid_input", "a student id is required");
    const next = applyPreferencePatch(await this.get(studentId), patch);
    this.rows.set(studentId, { ...next });
    return { ...next };
  }
}
