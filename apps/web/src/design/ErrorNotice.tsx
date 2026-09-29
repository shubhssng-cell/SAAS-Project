/**
 * An inline, perceivable error message (Product Phase 1 Unit 11) -- the same `.form-alert`
 * look the auth/onboarding/enrollment forms already used, now shared instead of re-typed.
 * `role="alert"` announces it the moment it appears. Callers pass student-safe copy only;
 * this component never renders an error object, code, or id.
 */
export function ErrorNotice({ children }: { children: string }) {
  return (
    <p className="form-alert" role="alert">
      {children}
    </p>
  );
}
