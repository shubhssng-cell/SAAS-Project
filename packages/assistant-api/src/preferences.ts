import { PreferenceError, validatePreferencePatch, type PreferenceStore, type StudentPreferences } from "@ipmat/personalization";
import { AssistantApiError, infrastructureError, invalidRequest, isRecord, type StudentClaim } from "./errors.js";

/**
 * A student's own explicit preferences (Phase 9 Unit 2, D-098). The student id is the AUTHENTICATED one; the body can never name
 * another. Validation is the domain's (`validatePreferencePatch`: three fields, closed vocabularies, trait-like names refused by
 * name); this service adds nothing to it and infers nothing. Storage is the Unit 1 `PreferenceStore`.
 */
export class PreferencesApiService {
  constructor(private readonly store: PreferenceStore) {}

  async get(claim: StudentClaim): Promise<{ preferences: StudentPreferences }> {
    try {
      return { preferences: await this.store.get(claim.studentId) };
    } catch (error) {
      throw infrastructureError(error, "Your preferences couldn't be loaded.");
    }
  }

  async update(claim: StudentClaim, body: unknown): Promise<{ preferences: StudentPreferences }> {
    if (!isRecord(body)) throw invalidRequest("The request body must be a JSON object.");
    try {
      validatePreferencePatch(body);
    } catch (error) {
      if (error instanceof PreferenceError) throw invalidRequest(error.message);
      throw new AssistantApiError("infrastructure_failure", "Your preferences couldn't be saved.", 500);
    }
    try {
      return { preferences: await this.store.set(claim.studentId, body) };
    } catch (error) {
      throw infrastructureError(error, "Your preferences couldn't be saved.");
    }
  }
}
