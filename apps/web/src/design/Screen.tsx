import type { ReactNode } from "react";

/**
 * The one page-container primitive every top-level screen and route in
 * this app uses -- extracted in Product Phase 1 Unit 3 because every
 * existing component (`Dashboard`, `QuestionPlayer`, `ResultScreen`,
 * `AutopsyCard`, `NextTrainingCard`) and every Unit 2 placeholder route
 * already independently wrapped its content in the same
 * `<div className="screen">` markup, several of them repeating the exact
 * same eyebrow/headline/subtext heading block too. Renders the SAME
 * `.screen`/`.eyebrow`/`.headline`/`.subtext` classes that already existed
 * -- no new CSS, no visual change for callers that migrate to it.
 *
 * `eyebrow`/`headline`/`subtext` are optional: a component that builds its
 * own heading (e.g. `AutopsyCard` uses only `headline`, `QuestionPlayer`
 * uses neither) can omit any of them. `role="alert"` (Product Phase 1 Unit
 * 11) is for whole-screen error states, so assistive tech announces them.
 */
export function Screen({ eyebrow, headline, subtext, role, children }: { eyebrow?: string; headline?: string; subtext?: string; role?: "alert"; children?: ReactNode }) {
  return (
    <div className="screen" role={role}>
      {eyebrow && <p className="eyebrow">{eyebrow}</p>}
      {headline && <h1 className="headline">{headline}</h1>}
      {subtext && <p className="subtext">{subtext}</p>}
      {children}
    </div>
  );
}
