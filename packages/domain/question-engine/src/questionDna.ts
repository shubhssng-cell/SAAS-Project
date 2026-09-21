import { hasConcept, type ConceptGraph } from "@ipmat/concept-graph";
import type { QuestionDnaData, QuestionPatternFamilyData } from "./types.js";

export interface ValidationIssue {
  field: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}

/**
 * Checks that a QuestionDnaData object references concepts and a pattern
 * family that actually exist, before anything is allowed to call it
 * "ready" — this is what makes "Question DNA references valid concepts/
 * patterns" a checkable fact rather than a hopeful convention.
 */
export function validateQuestionDna(
  dna: QuestionDnaData,
  graph: ConceptGraph,
  families: QuestionPatternFamilyData[]
): ValidationResult {
  const issues: ValidationIssue[] = [];

  if (!hasConcept(graph, dna.conceptName)) {
    issues.push({ field: "conceptName", message: `"${dna.conceptName}" is not a concept in the supplied graph` });
  }
  for (const sub of dna.subconcepts) {
    if (!hasConcept(graph, sub)) {
      issues.push({ field: "subconcepts", message: `"${sub}" is not a concept in the supplied graph` });
    }
  }
  for (const prereq of dna.prerequisites) {
    if (!hasConcept(graph, prereq)) {
      issues.push({ field: "prerequisites", message: `"${prereq}" is not a concept in the supplied graph` });
    }
  }
  for (const combo of dna.combinesWithConcepts) {
    if (!hasConcept(graph, combo)) {
      issues.push({ field: "combinesWithConcepts", message: `"${combo}" is not a concept in the supplied graph` });
    }
  }

  const family = families.find(
    (candidate) => candidate.name === dna.patternFamilyName && candidate.conceptName === dna.conceptName
  );
  if (!family) {
    issues.push({
      field: "patternFamilyName",
      message: `no pattern family named "${dna.patternFamilyName}" for concept "${dna.conceptName}"`
    });
  }

  if (dna.testingModes.length === 0) {
    issues.push({ field: "testingModes", message: "at least one testing mode is required" });
  }

  if (dna.validationState === "published" && !dna.provenanceSourceType) {
    issues.push({ field: "provenanceSourceType", message: "a published question must have a provenance source type" });
  }

  return { valid: issues.length === 0, issues };
}
