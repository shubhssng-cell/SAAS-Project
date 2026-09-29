import type { ButtonHTMLAttributes } from "react";

export type ButtonVariant = "primary" | "secondary";

/**
 * The one `<button>` primitive for this app -- wraps the same `.btn`/
 * `.btn-primary`/`.btn-secondary`/`.btn-block` classes every button already
 * used. Defaults `type="button"` (nothing in this app submits an HTML
 * form) but an explicit `type` prop still wins, same as any spread prop.
 * An optional `className` is appended (never replaces) the base classes --
 * an escape hatch for a one-off spacing modifier, not a way to redefine
 * the button's own look.
 */
export function Button({ variant = "primary", block, className, ...rest }: { variant?: ButtonVariant; block?: boolean } & ButtonHTMLAttributes<HTMLButtonElement>) {
  const classes = ["btn", variant === "primary" ? "btn-primary" : "btn-secondary", block ? "btn-block" : "", className ?? ""].filter(Boolean).join(" ");
  return <button type="button" className={classes} {...rest} />;
}
