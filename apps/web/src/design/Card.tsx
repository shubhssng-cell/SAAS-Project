import type { ReactNode } from "react";

/** The one `.card` surface primitive -- same class every card already used, now shared instead of re-typed per component. */
export function Card({ children }: { children?: ReactNode }) {
  return <div className="card">{children}</div>;
}
