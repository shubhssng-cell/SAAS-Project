import type { Prisma } from "@prisma/client";

/**
 * Prisma's Json input type wants a plain `InputJsonObject`; domain packages
 * export strongly-typed interfaces instead. This is a type-level impedance
 * mismatch at the Prisma boundary only — the runtime value is already
 * plain, serializable data (the same cast `packages/db/prisma/seed.ts`
 * already uses).
 */
export const asJson = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;
