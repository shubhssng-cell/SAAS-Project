# 53 — Persistence (`@ipmat/db` repository layer)

> Part of the [project memory](00_MASTER_CONTEXT.md). Source: `docs/DECISIONS.md` D-043, D-046–D-050, D-060, and the D-039 addendum (all read/verified directly this session).

## The pattern, established once (D-043), repeated every time since

Each repository is: a plain TypeScript **interface** (the contract), exactly one concrete `PrismaXRepository` (production), and an `InMemoryXRepository` test double implementing the **identical** interface, sharing the same validation functions (`packages/db/src/repositories/validation.ts`) so the two implementations cannot silently drift apart.

## `PersistenceError` — a distinct error family from domain-rule violations

Deliberately separate from `HypothesisError`/`AttemptLifecycleError` (which represent domain-rule violations the domain packages already guard on their own terms) — `PersistenceError` is specifically "this data is not safe to write" (malformed/empty ids, non-finite numeric measures, ownership mismatch).

## Which repositories exist, and their exact write cardinality

| Repository | Writes | Transaction needed? |
|---|---|---|
| `AutopsyRepository` | 1 (upsert) | No |
| `RepairPlanRepository` | 1 (insert) | No |
| `MasteryStateRepository` | 1 (upsert) | No |
| `AttemptRepository` | 3-part (parent upsert + child delete + child recreate) | **Yes** — first genuine multi-write in the codebase (D-046) |
| `PracticeSessionRepository`/`PracticeBlockRepository` | dedicated atomic methods | Yes, `Serializable`, per-method |
| `QuestionPublicationRepository` | 1 (conditional update) | Yes, `Serializable` (a later addendum fix, for a lost-update race) |
| `QuestionImportRepository` | multi-FK-resolve + insert | Yes, `Serializable` |

## `runSerializableTransaction()` — one named error, no automatic retry

Maps a genuine Postgres serialization failure (SQLSTATE 40001 / Prisma P2034) to `SerializationFailureError`. No repository anywhere in this codebase automatically retries a serialization failure.

## Nullable columns represent "insufficient evidence," never a default (D-043)

The 5 `MasteryState` scalar columns are nullable `Float?` — SQL `NULL` means exactly what the domain layer's `null` already means; a real float, including `0.0`, means measured. The same discipline was extended in the D-039 addendum to `RepairPlan`'s 6 new snapshot columns and `Autopsy.confirmedAt` — `NULL` there means "this row predates the fix," never a legitimate domain state.

## Foreign-key resolution is the repository's job, never the domain layer's

`toXPersistenceRecord()` functions are pure and take already-resolved ids as parameters; `PrismaXRepository` implementations resolve `ErrorTaxonomy.code -> id`/`Concept.name -> id` via real Prisma queries before calling them. `Concept.name` resolution is a deliberately narrow, name-only lookup (an honest single-chapter simplification, flagged for revisit if a second chapter is built).

## The load-bearing fact for the next architectural unit

**Every repository method that exists today is a narrow, single-entity, look-up-by-known-id method.** There is no bulk "all X for this student" query anywhere in `@ipmat/db` — this was the central finding of the Training Recommendation Composition design review, and the reason 6 new repository methods had to be specified from scratch. See [37_TRAINING_RECOMMENDATION.md](37_TRAINING_RECOMMENDATION.md).

## No live database, anywhere, ever, in this project's history

Every `PrismaXRepository` class is typechecked against the real generated Prisma Client types but has **never been executed against a real database.** Round-trip persistence semantics are verified exclusively against `InMemoryXRepository` doubles or hand-rolled fake `PrismaClient` objects (`vi.fn()`-based, proving exact query shape/isolation level without a live connection). This is a standing, repeatedly-disclosed caveat across every single phase — see [92_CURRENT_STATE.md](92_CURRENT_STATE.md).

See also: [54_SECURITY_AND_OWNERSHIP.md](54_SECURITY_AND_OWNERSHIP.md).
