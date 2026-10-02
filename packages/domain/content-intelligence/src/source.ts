import { createHash } from "node:crypto";
import { evaluateSourceRights } from "@ipmat/content-authoring";
import { ContentIntelligenceError, type SourceInput, type SourceRecord } from "./types.js";

const sha256 = (text: string): string => createHash("sha256").update(text, "utf8").digest("hex");
const blank = (v: unknown): boolean => typeof v !== "string" || v.trim() === "";
const SOURCE_KEY = /^[a-z0-9][a-z0-9._-]{0,63}$/;

/** sha256 of the content exactly as supplied. The version identity and the change detector. */
export function contentHash(content: string): string {
  return sha256(content);
}

/** Deterministic, so registering the same (exam, key) twice is the same source. */
export function sourceIdFor(examCode: string, sourceKey: string): string {
  return `src_${sha256(`source\n${examCode}\n${sourceKey}`).slice(0, 32)}`;
}

/** Deterministic from (source, content hash): the same content is the same version. */
export function sourceVersionIdFor(sourceId: string, hash: string): string {
  return `ver_${sha256(`version\n${sourceId}\n${hash}`).slice(0, 32)}`;
}

export interface SourceProblem {
  code: string;
  field: string;
  message: string;
}

/**
 * Everything that must hold for a source to be registered. The rights rules
 * are the SAME ones that guard a question's provenance (`evaluateSourceRights`,
 * Prompt 3), plus: a named authority for third-party material, and an
 * unambiguous real-source/fixture distinction. A source that fails any of
 * them is refused and nothing about it is persisted.
 */
export function evaluateSource(input: SourceInput): { rights: SourceProblem[]; structure: SourceProblem[] } {
  const rights: SourceProblem[] = evaluateSourceRights({ sourceType: input.sourceType, sourceRef: input.sourceRef, licenseRef: input.licenseRef, attributedTo: input.attributedTo });
  const structure: SourceProblem[] = [];
  const problem = (code: string, field: string, message: string) => structure.push({ code, field, message });

  if (blank(input.examCode)) problem("missing_exam", "examCode", "a source belongs to exactly one exam");
  if (blank(input.sourceKey) || !SOURCE_KEY.test(input.sourceKey)) problem("invalid_source_key", "sourceKey", "sourceKey must be lowercase letters, digits, '.', '_' or '-' (max 64)");
  if (blank(input.title)) problem("missing_title", "title", "a source needs a title");
  if (input.sourceType !== "original" && input.sourceType !== "public_domain" && blank(input.authority)) {
    rights.push({ code: "authority_required", field: "authority", message: "third-party material must name its owner / rights holder (authority)" });
  }
  if (input.dataOrigin === "fixture") {
    if (blank(input.fixtureLabel)) problem("fixture_label_required", "fixtureLabel", "a fixture must carry a label stating it is not a real source");
    if (input.sourceType !== "original") problem("fixture_must_be_original", "sourceType", 'a fixture is authored by this project: its source type must be "original"');
    if (!String(input.sourceRef ?? "").startsWith("fixture:")) problem("fixture_ref_required", "sourceRef", 'a fixture\'s sourceRef must start with "fixture:" so it can never pass as a real source');
  } else if (input.dataOrigin === "real_source") {
    if (input.fixtureLabel !== null) problem("fixture_label_on_real_source", "fixtureLabel", "a real source must not carry a fixture label");
    if (String(input.sourceRef ?? "").startsWith("fixture:")) problem("fixture_ref_on_real_source", "sourceRef", 'a "fixture:" reference cannot name a real source');
  } else {
    problem("unknown_data_origin", "dataOrigin", `unknown data origin "${String(input.dataOrigin)}"`);
  }
  return { rights, structure };
}

/**
 * Validates and canonicalizes a source for registration. Throws
 * `unauthorized_source` for any rights problem (the source never enters the
 * pipeline) or `invalid_source` for a structural one.
 */
export function registerableSource(input: SourceInput): SourceRecord {
  const { rights, structure } = evaluateSource(input);
  if (rights.length > 0) throw new ContentIntelligenceError("unauthorized_source", `source "${input.sourceKey}" is not authorized for ingestion: ${rights.map((r) => r.code).join(", ")}`, rights);
  if (structure.length > 0) throw new ContentIntelligenceError("invalid_source", `source "${input.sourceKey}" is invalid: ${structure.map((r) => r.code).join(", ")}`, structure);
  return { ...input, id: sourceIdFor(input.examCode, input.sourceKey) };
}
