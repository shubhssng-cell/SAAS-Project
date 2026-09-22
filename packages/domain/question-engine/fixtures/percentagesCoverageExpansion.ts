import type { AnswerReverificationAiOutput, QuestionCandidateAiOutput, ValidationJudgeAiOutput } from "@ipmat/ai";
import { buildBlueprintFromCell, type QuestionBlueprint } from "../src/blueprint.js";
import { percentagesPatternFamilies } from "./percentagesPatternFamilies.js";
import { percentagesTaxonomyCells } from "./percentagesTaxonomyCells.js";

/**
 * Phase 3.5 — hand-authored fixture triples (candidate / reverification /
 * judge) for every Percentages taxonomy cell that was still `uncovered`
 * after Phase 2, one candidate per cell (never a cluster of near-identical
 * variants — Phase 3.5 §6/§9). Each triple is fed to a `FixtureProvider`
 * and run through the REAL `runGenerationPipeline()` — the exact same
 * blueprint/AI-abstraction/deterministic-validation/lifecycle code path a
 * live model call would go through. **These are deterministic
 * development-time fixtures, not real-model output** — no live
 * `ANTHROPIC_API_KEY` was available or used to produce them (Phase 3.5 is
 * explicitly deferred from a real provider run, see docs/MASTER_PLAN.md).
 * Nothing here is presented as, or treated as, AI-validated by a real
 * model; it is validated by the same deterministic pipeline every other
 * fixture in this codebase already goes through `FixtureProvider` for.
 *
 * Every arithmetic answer below is independently checkable: mathjs
 * recomputes `groundTruthDerivation.computation` and must agree with both
 * `expectedAnswer` and `correctAnswer` (`verifyComputation()`), so a wrong
 * value here would fail deterministically, not silently pass because an AI
 * said so.
 */

function findCell(
  patternFamilyName: string,
  combination: string[],
  testingMode: string,
  trapErrorTaxonomyCode: string,
  difficultyTier: string
) {
  const cell = percentagesTaxonomyCells.find(
    (c) =>
      c.patternFamilyName === patternFamilyName &&
      c.testingMode === testingMode &&
      c.trapErrorTaxonomyCode === trapErrorTaxonomyCode &&
      c.difficultyTier === difficultyTier &&
      c.combination.length === combination.length &&
      c.combination.every((x) => combination.includes(x))
  );
  if (!cell) {
    throw new Error(`Expected an uncovered taxonomy cell for ${patternFamilyName}/${combination.join("+")}/${testingMode}/${trapErrorTaxonomyCode}/${difficultyTier}`);
  }
  return cell;
}

function findFamily(name: string) {
  const family = percentagesPatternFamilies.find((f) => f.name === name);
  if (!family) throw new Error(`Expected pattern family "${name}" to exist`);
  return family;
}

export interface CoverageExpansionFixture {
  label: string;
  blueprint: QuestionBlueprint;
  candidate: QuestionCandidateAiOutput;
  reverification: AnswerReverificationAiOutput;
  judge: ValidationJudgeAiOutput;
}

const passingJudge = (): ValidationJudgeAiOutput => ({
  syllabusRelevant: true,
  hasExactlyOneDefensibleAnswer: true,
  isAmbiguous: false,
  hasContradictoryConditions: false,
  difficultyTierIsHonest: true,
  issues: [],
  verdict: "pass"
});

// ---------------------------------------------------------------------
// Cell 1 — Reverse Percentage / Algebra / transformed / base_confusion / hard
// ---------------------------------------------------------------------

const cell1 = findCell("Reverse Percentage", ["Algebra"], "transformed", "base_confusion", "hard");
const family1 = findFamily("Reverse Percentage");
const blueprint1 = buildBlueprintFromCell(cell1, family1, {
  examCode: "IPMAT_INDORE",
  sectionName: "Quant",
  chapterName: "Percentages",
  answerFormat: "multiple_choice",
  transformationDescription: "Hide the changed value behind an algebraic expression in a second variable rather than stating it as a plain number.",
  idSuffix: "phase3-5-reverse-algebra-hard"
});

export const reverseAlgebraHard: CoverageExpansionFixture = {
  label: "Reverse Percentage x Algebra (hard, transformed)",
  blueprint: blueprint1,
  candidate: {
    blueprintId: blueprint1.id,
    stem: "A quantity P is increased by 25%, and the result equals (3y − 30), where y = 110. What was the value of P before the increase?",
    answerFormat: "multiple_choice",
    options: ["225", "240", "300", "375"],
    correctAnswer: "240",
    explanation:
      "First evaluate the algebraic expression to get the increased value, then divide by the growth factor to recover the original quantity — dividing by 1.25 undoes a 25% increase; multiplying by 1.25 would apply another increase instead.",
    solutionSteps: [
      "Evaluate the expression: 3 x 110 - 30 = 300.",
      "This 300 represents 125% of P (a 25% increase over P).",
      "P = 300 / 1.25 = 240."
    ],
    reasoning: "Resolve the algebraic expression to a plain number first, then treat it exactly like an ordinary reverse-percentage problem: divide by the growth factor, never multiply.",
    groundTruthDerivation: { computation: "(3 * 110 - 30) / 1.25", expectedAnswer: 240 },
    questionDna: {
      conceptName: "Percentages",
      subconcepts: [],
      prerequisites: [],
      combinesWithConcepts: ["Algebra"],
      patternFamilyName: "Reverse Percentage",
      skill: family1.skill,
      difficultyTier: "hard",
      difficultyDimensions: blueprint1.difficultyDimensions,
      noveltyLevel: "standard",
      examRelevance: "core",
      expectedTimeSeconds: blueprint1.expectedTimeSeconds,
      testingModes: ["transformed"],
      trapErrorTaxonomyCode: "base_confusion"
    }
  },
  reverification: {
    derivedAnswer: "240",
    derivationSteps: ["3 x 110 - 30 = 300", "300 is 125% of P", "P = 300 / 1.25 = 240"]
  },
  judge: passingJudge()
};

// ---------------------------------------------------------------------
// Cell 2 — Successive Percentage Change / Profit and Loss / combined / successive_change_error / advanced
// ---------------------------------------------------------------------

const cell2 = findCell("Successive Percentage Change", ["Profit and Loss"], "combined", "successive_change_error", "advanced");
const family2 = findFamily("Successive Percentage Change");
const blueprint2 = buildBlueprintFromCell(cell2, family2, {
  examCode: "IPMAT_INDORE",
  sectionName: "Quant",
  chapterName: "Percentages",
  answerFormat: "multiple_choice",
  transformationDescription: "A markup followed by a discount on a Profit and Loss scenario, inviting the additive '20% net' shortcut instead of compounding.",
  idSuffix: "phase3-5-successive-pnl-advanced"
});

export const successivePnlAdvanced: CoverageExpansionFixture = {
  label: "Successive Percentage Change x Profit and Loss (advanced, combined)",
  blueprint: blueprint2,
  candidate: {
    blueprintId: blueprint2.id,
    stem: "A shopkeeper marks up an item's cost price of ₹500 by 40%, then during a clearance sale offers a 20% discount on the marked price. What is the final selling price?",
    answerFormat: "multiple_choice",
    options: ["520", "550", "560", "600"],
    correctAnswer: "560",
    explanation:
      "Two successive percentage changes must be applied one after another to the evolving value, never combined by simply adding/subtracting the percentages — a 40% markup followed by a 20% discount is NOT a net 20% change.",
    solutionSteps: [
      "Marked price after a 40% markup = 500 x 1.40 = 700.",
      "Sale price after a 20% discount on the marked price = 700 x 0.80 = 560.",
      "Final selling price = 560."
    ],
    reasoning: "Apply each percentage change multiplicatively to the value produced by the previous step, rather than summing the two percentages into one net change.",
    groundTruthDerivation: { computation: "500 * 1.4 * 0.8", expectedAnswer: 560 },
    questionDna: {
      conceptName: "Percentages",
      subconcepts: [],
      prerequisites: [],
      combinesWithConcepts: ["Profit and Loss"],
      patternFamilyName: "Successive Percentage Change",
      skill: family2.skill,
      difficultyTier: "advanced",
      difficultyDimensions: blueprint2.difficultyDimensions,
      noveltyLevel: "standard",
      examRelevance: "core",
      expectedTimeSeconds: blueprint2.expectedTimeSeconds,
      testingModes: ["combined"],
      trapErrorTaxonomyCode: "successive_change_error"
    }
  },
  reverification: {
    derivedAnswer: "560",
    derivationSteps: ["500 x 1.40 = 700 after markup", "700 x 0.80 = 560 after discount"]
  },
  judge: passingJudge()
};

// ---------------------------------------------------------------------
// Cell 3 — Successive Percentage Change / Simple and Compound Interest / multi_step / successive_change_error / hard
// ---------------------------------------------------------------------

const cell3 = findCell("Successive Percentage Change", ["Simple and Compound Interest"], "multi_step", "successive_change_error", "hard");
const family3 = findFamily("Successive Percentage Change");
const blueprint3 = buildBlueprintFromCell(cell3, family3, {
  examCode: "IPMAT_INDORE",
  sectionName: "Quant",
  chapterName: "Percentages",
  answerFormat: "multiple_choice",
  transformationDescription: "Three sequential percentage changes over three periods, one more step than the advanced-tier version of this family.",
  idSuffix: "phase3-5-successive-interest-hard"
});

export const successiveInterestHard: CoverageExpansionFixture = {
  label: "Successive Percentage Change x Simple and Compound Interest (hard, multi_step)",
  blueprint: blueprint3,
  candidate: {
    blueprintId: blueprint3.id,
    stem:
      "A sum of ₹2,000 grows by 10% in the first year, then decreases by 10% in the second year due to a partial withdrawal, and finally grows by 5% in the third year. What is the final amount?",
    answerFormat: "multiple_choice",
    options: ["2000", "2079", "2100", "2178"],
    correctAnswer: "2079",
    explanation:
      "With three sequential percentage changes, each must multiply the running amount left by the previous step — a common mistake is to add the three percentages (10 - 10 + 5 = 5%) and apply that single combined rate to the original sum instead.",
    solutionSteps: [
      "After year 1 (10% growth): 2000 x 1.10 = 2200.",
      "After year 2 (10% decrease): 2200 x 0.90 = 1980.",
      "After year 3 (5% growth): 1980 x 1.05 = 2079."
    ],
    reasoning: "Chain the three multiplicative factors against the running total from the prior step, never against the original principal directly after the first step.",
    groundTruthDerivation: { computation: "2000 * 1.10 * 0.90 * 1.05", expectedAnswer: 2079 },
    questionDna: {
      conceptName: "Percentages",
      subconcepts: [],
      prerequisites: [],
      combinesWithConcepts: ["Simple and Compound Interest"],
      patternFamilyName: "Successive Percentage Change",
      skill: family3.skill,
      difficultyTier: "hard",
      difficultyDimensions: blueprint3.difficultyDimensions,
      noveltyLevel: "standard",
      examRelevance: "core",
      expectedTimeSeconds: blueprint3.expectedTimeSeconds,
      testingModes: ["multi_step"],
      trapErrorTaxonomyCode: "successive_change_error"
    }
  },
  reverification: {
    derivedAnswer: "2079",
    derivationSteps: ["2000 x 1.10 = 2200", "2200 x 0.90 = 1980", "1980 x 1.05 = 2079"]
  },
  judge: passingJudge()
};

// ---------------------------------------------------------------------
// Cell 4 — Percentage Point vs Percentage Change / Simple and Compound Interest / contextualized / percentage_point_confusion / hard
// ---------------------------------------------------------------------

const cell4 = findCell("Percentage Point vs Percentage Change", ["Simple and Compound Interest"], "contextualized", "percentage_point_confusion", "hard");
const family4 = findFamily("Percentage Point vs Percentage Change");
const blueprint4 = buildBlueprintFromCell(cell4, family4, {
  examCode: "IPMAT_INDORE",
  sectionName: "Quant",
  chapterName: "Percentages",
  answerFormat: "multiple_choice",
  transformationDescription: "Both interest rates must first be derived from raw amounts before the point-vs-relative-change distinction can even be evaluated.",
  idSuffix: "phase3-5-point-interest-hard"
});

export const percentagePointInterestHard: CoverageExpansionFixture = {
  label: "Percentage Point vs Percentage Change x Simple and Compound Interest (hard, contextualized)",
  blueprint: blueprint4,
  candidate: {
    blueprintId: blueprint4.id,
    stem:
      "Two savings schemes, A and B, both start with a principal of ₹10,000. After one year, Scheme A yields simple interest of ₹800 and Scheme B yields simple interest of ₹1,000. A bank advisor claims Scheme B's rate is '2% better' than Scheme A's. By how many percentage points does Scheme B's annual interest rate actually exceed Scheme A's?",
    answerFormat: "multiple_choice",
    options: ["0.2", "2", "20", "25"],
    correctAnswer: "2",
    explanation:
      "The two annual rates must first be derived from the stated interest amounts, and the honest comparison between them is the absolute point difference, not a relative percentage-of-a-percentage figure — the advisor's '2% better' framing is exactly the kind of loose language this trap is designed to catch.",
    solutionSteps: [
      "Scheme A's rate = 800 / 10000 x 100 = 8%.",
      "Scheme B's rate = 1000 / 10000 x 100 = 10%.",
      "Percentage-point difference = 10 - 8 = 2 percentage points."
    ],
    reasoning: "Derive both rates independently from the raw interest figures, then subtract them directly — the point difference is not the same figure as the relative percentage change between the two rates.",
    groundTruthDerivation: { computation: "1000 / 10000 * 100 - 800 / 10000 * 100", expectedAnswer: 2 },
    questionDna: {
      conceptName: "Percentages",
      subconcepts: [],
      prerequisites: [],
      combinesWithConcepts: ["Simple and Compound Interest"],
      patternFamilyName: "Percentage Point vs Percentage Change",
      skill: family4.skill,
      difficultyTier: "hard",
      difficultyDimensions: blueprint4.difficultyDimensions,
      noveltyLevel: "standard",
      examRelevance: "core",
      expectedTimeSeconds: blueprint4.expectedTimeSeconds,
      testingModes: ["contextualized"],
      trapErrorTaxonomyCode: "percentage_point_confusion"
    }
  },
  reverification: {
    derivedAnswer: "2",
    derivationSteps: ["Rate A = 800/10000 x 100 = 8%", "Rate B = 1000/10000 x 100 = 10%", "Difference = 10 - 8 = 2 points"]
  },
  judge: passingJudge()
};

// ---------------------------------------------------------------------
// Cell 5 — Percentage Point vs Percentage Change / (no combination) / contextualized / percentage_point_confusion / standard
// ---------------------------------------------------------------------

const cell5 = findCell("Percentage Point vs Percentage Change", [], "contextualized", "percentage_point_confusion", "standard");
const family5 = findFamily("Percentage Point vs Percentage Change");
const blueprint5 = buildBlueprintFromCell(cell5, family5, {
  examCode: "IPMAT_INDORE",
  sectionName: "Quant",
  chapterName: "Percentages",
  answerFormat: "multiple_choice",
  transformationDescription: "A single, standalone discount-rate comparison with no combined concept — the direct, minimal form of this pattern family.",
  idSuffix: "phase3-5-point-standalone-standard"
});

export const percentagePointStandaloneStandard: CoverageExpansionFixture = {
  label: "Percentage Point vs Percentage Change, standalone (standard, contextualized)",
  blueprint: blueprint5,
  candidate: {
    blueprintId: blueprint5.id,
    stem: "A store's discount on a jacket was reduced from 30% to 25% ahead of a sale. By how many percentage points did the discount decrease?",
    answerFormat: "multiple_choice",
    options: ["5", "5.5", "16.7", "30"],
    correctAnswer: "5",
    explanation:
      "The question asks directly for the point difference between the two discount rates, not the relative percentage change between them.",
    solutionSteps: ["Original discount rate = 30%.", "New discount rate = 25%.", "Point difference = 30 - 25 = 5 percentage points."],
    reasoning: "Subtract the two stated percentage figures directly; do not divide the difference by the original rate, which would instead give the relative percentage change.",
    groundTruthDerivation: { computation: "30 - 25", expectedAnswer: 5 },
    questionDna: {
      conceptName: "Percentages",
      subconcepts: [],
      prerequisites: [],
      combinesWithConcepts: [],
      patternFamilyName: "Percentage Point vs Percentage Change",
      skill: family5.skill,
      difficultyTier: "standard",
      difficultyDimensions: blueprint5.difficultyDimensions,
      noveltyLevel: "standard",
      examRelevance: "core",
      expectedTimeSeconds: blueprint5.expectedTimeSeconds,
      testingModes: ["contextualized"],
      trapErrorTaxonomyCode: "percentage_point_confusion"
    }
  },
  reverification: {
    derivedAnswer: "5",
    derivationSteps: ["30 - 25 = 5 percentage points"]
  },
  judge: passingJudge()
};

// ---------------------------------------------------------------------
// Cell 6 — Percentage Share in Data Interpretation / Data Interpretation / represented_differently / misread_question / hard
// ---------------------------------------------------------------------

const cell6 = findCell("Percentage Share in Data Interpretation", ["Data Interpretation"], "represented_differently", "misread_question", "hard");
const family6 = findFamily("Percentage Share in Data Interpretation");
const blueprint6 = buildBlueprintFromCell(cell6, family6, {
  examCode: "IPMAT_INDORE",
  sectionName: "Quant",
  chapterName: "Percentages",
  answerFormat: "multiple_choice",
  transformationDescription: "Raw sales figures across categories described in prose rather than a pre-computed percentage table.",
  idSuffix: "phase3-5-share-di-hard"
});

export const percentageShareDiHard: CoverageExpansionFixture = {
  label: "Percentage Share in Data Interpretation (hard, represented_differently)",
  blueprint: blueprint6,
  candidate: {
    blueprintId: blueprint6.id,
    stem:
      "A retailer's total monthly sales of ₹80,000 are split across three categories: Electronics ₹32,000, Apparel ₹28,000, and Home Goods ₹20,000. What percentage of total sales does Apparel represent?",
    answerFormat: "multiple_choice",
    options: ["25", "32", "35", "40"],
    correctAnswer: "35",
    explanation:
      "The figures must be extracted correctly from the raw description before computing a share — a common mistake is to answer for the wrong category entirely (e.g. Electronics' share) after misreading which category the question actually asks about.",
    solutionSteps: ["Apparel's sales = 28,000.", "Total sales = 80,000.", "Apparel's share = 28,000 / 80,000 x 100 = 35%."],
    reasoning: "Identify the correct category's figure from the raw description first, then divide by the stated total — do not answer for a different category's share.",
    groundTruthDerivation: { computation: "28000 / 80000 * 100", expectedAnswer: 35 },
    questionDna: {
      conceptName: "Percentages",
      subconcepts: [],
      prerequisites: [],
      combinesWithConcepts: ["Data Interpretation"],
      patternFamilyName: "Percentage Share in Data Interpretation",
      skill: family6.skill,
      difficultyTier: "hard",
      difficultyDimensions: blueprint6.difficultyDimensions,
      noveltyLevel: "standard",
      examRelevance: "core",
      expectedTimeSeconds: blueprint6.expectedTimeSeconds,
      testingModes: ["represented_differently"],
      trapErrorTaxonomyCode: "misread_question"
    }
  },
  reverification: {
    derivedAnswer: "35",
    derivationSteps: ["Apparel = 28000", "Total = 80000", "28000/80000 x 100 = 35%"]
  },
  judge: passingJudge()
};

// ---------------------------------------------------------------------
// Cell 7 — Percentage Share in Data Interpretation / Data Interpretation + Averages / combined / base_confusion / extreme
// ---------------------------------------------------------------------

const cell7 = findCell("Percentage Share in Data Interpretation", ["Data Interpretation", "Averages"], "combined", "base_confusion", "extreme");
const family7 = findFamily("Percentage Share in Data Interpretation");
const blueprint7 = buildBlueprintFromCell(cell7, family7, {
  examCode: "IPMAT_INDORE",
  sectionName: "Quant",
  chapterName: "Percentages",
  answerFormat: "multiple_choice",
  transformationDescription: "A percentage increase applied to a 4-month AVERAGE that must itself be computed first, not to the most recent month's raw figure.",
  idSuffix: "phase3-5-share-di-averages-extreme"
});

export const percentageShareDiAveragesExtreme: CoverageExpansionFixture = {
  label: "Percentage Share in Data Interpretation x Averages (extreme, combined)",
  blueprint: blueprint7,
  candidate: {
    blueprintId: blueprint7.id,
    stem:
      "Over 4 months, a company's expenses were: January ₹45,000, February ₹50,000, March ₹55,000, and April ₹60,000. If May's expense increases by 20% over the average of the previous 4 months, what is May's expense?",
    answerFormat: "multiple_choice",
    options: ["52500", "60000", "63000", "72000"],
    correctAnswer: "63000",
    explanation:
      "The 20% increase must be applied to the computed AVERAGE of the four months, not to April's raw figure — a base-confusion mistake applies the growth to the most recent value instead of the quantity the question actually specifies as the base.",
    solutionSteps: [
      "Average of the 4 months = (45,000 + 50,000 + 55,000 + 60,000) / 4 = 52,500.",
      "May's expense = 52,500 x 1.20 = 63,000."
    ],
    reasoning: "Compute the average first as its own separate step, then apply the percentage increase to that average — never to the last individual month's figure.",
    groundTruthDerivation: { computation: "(45000 + 50000 + 55000 + 60000) / 4 * 1.2", expectedAnswer: 63000 },
    questionDna: {
      conceptName: "Percentages",
      subconcepts: [],
      prerequisites: [],
      combinesWithConcepts: ["Data Interpretation", "Averages"],
      patternFamilyName: "Percentage Share in Data Interpretation",
      skill: family7.skill,
      difficultyTier: "extreme",
      difficultyDimensions: blueprint7.difficultyDimensions,
      noveltyLevel: "novel_context",
      examRelevance: "core",
      expectedTimeSeconds: blueprint7.expectedTimeSeconds,
      testingModes: ["combined"],
      trapErrorTaxonomyCode: "base_confusion"
    }
  },
  reverification: {
    derivedAnswer: "63000",
    derivationSteps: ["Average = (45000+50000+55000+60000)/4 = 52500", "52500 x 1.20 = 63000"]
  },
  judge: passingJudge()
};

export const coverageExpansionFixtures: CoverageExpansionFixture[] = [
  reverseAlgebraHard,
  successivePnlAdvanced,
  successiveInterestHard,
  percentagePointInterestHard,
  percentagePointStandaloneStandard,
  percentageShareDiHard,
  percentageShareDiAveragesExtreme
];

// ---------------------------------------------------------------------
// Duplicate-risk demonstration — NOT part of coverage expansion. A
// deliberate near-twin of `percentagePointStandaloneStandard` (same
// structure, same wording, only the discount figures differ) run through
// the SAME real pipeline to prove `checkDuplicateRisk()` actually rejects
// a materially redundant question rather than merely existing unused
// (Phase 3.5 §9). This candidate is excluded from every coverage count.
// ---------------------------------------------------------------------

export const duplicateRiskDemoFixture: CoverageExpansionFixture = {
  label: "Duplicate-risk demonstration (deliberately near-identical to the standalone percentage-point cell)",
  blueprint: blueprint5,
  candidate: {
    blueprintId: blueprint5.id,
    stem: "A store's discount on a jacket was reduced from 30% to 20% ahead of a sale. By how many percentage points did the discount decrease?",
    answerFormat: "multiple_choice",
    options: ["10", "10.5", "33.3", "30"],
    correctAnswer: "10",
    explanation: "The point difference between the two discount rates is the direct subtraction, not a relative percentage change.",
    solutionSteps: ["Original discount rate = 30%.", "New discount rate = 20%.", "Point difference = 30 - 20 = 10 percentage points."],
    reasoning: "Subtract the two stated percentage figures directly.",
    groundTruthDerivation: { computation: "30 - 20", expectedAnswer: 10 },
    questionDna: {
      conceptName: "Percentages",
      subconcepts: [],
      prerequisites: [],
      combinesWithConcepts: [],
      patternFamilyName: "Percentage Point vs Percentage Change",
      skill: family5.skill,
      difficultyTier: "standard",
      difficultyDimensions: blueprint5.difficultyDimensions,
      noveltyLevel: "standard",
      examRelevance: "core",
      expectedTimeSeconds: blueprint5.expectedTimeSeconds,
      testingModes: ["contextualized"],
      trapErrorTaxonomyCode: "percentage_point_confusion"
    }
  },
  reverification: { derivedAnswer: "10", derivationSteps: ["30 - 20 = 10 percentage points"] },
  judge: passingJudge()
};
