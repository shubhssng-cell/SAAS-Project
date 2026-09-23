import { buildTrainingSystemDiagnostics } from "./diagnostics.js";
import type { TrainingSystemContext, TrainingSystemOutcome, TrainingSystemProvider } from "./types.js";

/**
 * The CANONICAL, and intended ONLY, way to invoke a `TrainingSystemProvider`
 * — joins `evaluate()` and `select()` into one call so applicability is
 * decided in exactly one place: if `evaluate()` returns `applicable:
 * false`, `select()` is never called at all, and `not_applicable` is
 * returned directly with its own diagnostics (never delegated to the
 * provider to construct, keeping THAT diagnostics record consistent
 * regardless of which provider produced it). If `evaluate()` returns
 * `applicable: true`, its EXACT evaluation (requirement + explanation) is
 * passed through to `select()` unmodified — the provider is never asked,
 * and structurally cannot, re-decide applicability from `select()`
 * (`TrainingSystemSelectionOutcome` has no `not_applicable` variant).
 *
 * A provider's own `evaluate()`/`select()` methods remain independently
 * unit-testable in isolation (useful for a future provider's own test
 * suite), but application code assembling a real training flow should
 * always go through this function, never call `select()` directly.
 */
export function runTrainingSystemProvider(provider: TrainingSystemProvider, context: TrainingSystemContext): TrainingSystemOutcome {
  const applicability = provider.evaluate(context);

  if (!applicability.applicable) {
    return {
      status: "not_applicable",
      reason: applicability.reason,
      explanation: applicability.explanation,
      diagnostics: buildTrainingSystemDiagnostics({ providerId: provider.providerId, studentId: context.studentId, eligible: false })
    };
  }

  return provider.select(context, { requirement: applicability.requirement, explanation: applicability.explanation });
}
