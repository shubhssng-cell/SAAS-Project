import { describe } from "vitest";
import { InMemoryBillingStore } from "../../src/repositories/inMemoryBilling.js";
import { billingContract, usageContract, type BillingContractEnv } from "./billingContracts.js";

/** The in-memory reference implementation satisfies the SAME contracts as the Postgres one (see billingPersistence.integration.test.ts). */
const students = new Set(["student-a", "student-b"]);
const store = new InMemoryBillingStore(students);
const env: BillingContractEnv = { store, provider: "test-provider", studentA: "student-a", studentB: "student-b", unknownStudent: "no-such-student", uid: (label) => `mem-${label}` };

describe("billing persistence contract - in-memory", () => {
  billingContract(() => env);
});
describe("usage persistence contract - in-memory", () => {
  usageContract(() => env);
});
