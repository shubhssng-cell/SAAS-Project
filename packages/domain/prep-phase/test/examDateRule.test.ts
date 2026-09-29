import { describe, expect, it } from "vitest";
import { ExamDateRuleError, resolveExamDate } from "../src/examDateRule.js";

describe("resolveExamDate", () => {
  it("resolves a fixed_date rule to its date", () => {
    expect(resolveExamDate({ type: "fixed_date", date: "2027-01-15" })).toBe("2027-01-15");
  });

  it.each([null, undefined, "a string", 42, {}, { type: "fixed_date" }, { type: "fixed_date", date: 123 }, { type: "fixed_date", date: "" }, { type: "unknown_rule_type", date: "2027-01-15" }])(
    "fails closed (throws ExamDateRuleError) for malformed/unsupported input: %j",
    (input) => {
      expect(() => resolveExamDate(input)).toThrow(ExamDateRuleError);
    }
  );
});
