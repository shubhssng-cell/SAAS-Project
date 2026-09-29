import type { ReactNode } from "react";

/** The id a field's validation message renders under -- inputs reference it via `aria-describedby` so the message is announced with the field, not just shown near it. */
export function fieldErrorId(htmlFor: string): string {
  return `${htmlFor}-error`;
}

/** The one form-field primitive: an associated label, the input itself, and an optional field-level validation message. Introduced in Product Phase 1 Unit 5 — the first unit with real form inputs. */
export function FormField({ label, htmlFor, error, children }: { label: string; htmlFor: string; error?: string | null; children: ReactNode }) {
  return (
    <div className="form-field">
      <label htmlFor={htmlFor} className="form-label">
        {label}
      </label>
      {children}
      {error && (
        <p className="form-error" id={fieldErrorId(htmlFor)} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
