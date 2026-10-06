import type { PersonalizationDecision } from "./decisions.js";
import { PREFERENCE_FIELDS, type StudentPreferences } from "./preferences.js";
import type { PersonalizationReport } from "./training.js";

/**
 * Official exam simulations are NEVER personalized (SIM-0). Timing, sections, question counts, marking and
 * navigation come only from the exam configuration (D-090), and this package does not import the
 * simulation engine (boundary-tested), so it has no way to reach them. Accommodations such as extra time
 * are a separate product/legal policy that is not specified, and are therefore not offered here.
 *
 * The function exists to make the guarantee a stated, tested output: whatever preferences are set, the
 * report says nothing about the simulation was altered, and records which preferences were set but not
 * applied.
 */
export function simulationPersonalization(preferences: StudentPreferences): PersonalizationReport {
  const decisions: PersonalizationDecision[] = PREFERENCE_FIELDS.filter((f) => preferences[f] !== null).map((field) => ({
    dimension: "simulation" as const,
    rule: "SIM-0" as const,
    input: { kind: "explicit_preference" as const, field, value: String(preferences[field]) },
    effect: "not_applied" as const,
    limitedBy: null,
    output: "an official simulation's timing, sections, counts, marking and navigation come only from the exam configuration; this preference was not applied to it"
  }));
  if (decisions.length === 0) decisions.push({ dimension: "simulation", rule: "SIM-0", input: { kind: "none" }, effect: "not_applied", limitedBy: null, output: "an official simulation is never personalized" });
  return { altered: false, selectionAltered: false, presentationAltered: false, decisions };
}
