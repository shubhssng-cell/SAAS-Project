import { defineWorkspace } from "vitest/config";

/**
 * Two projects so that the real-database integration files NEVER run concurrently with each other.
 * They all share ONE disposable Postgres (`IPMAT_TEST_DATABASE_URL`) and several of them legitimately publish
 * questions or assert the exact published set; run in parallel they would observe each other's rows (found during
 * Product Phase 6 Prompt 4 verification: a published fixture from one file made an exact-published-set assertion in
 * another flake). Serializing them changes no assertion and no test; everything else still runs in parallel. Without
 * `IPMAT_TEST_DATABASE_URL` the integration files are skipped, exactly as before.
 */
const exclude = ["**/node_modules/**", "**/dist/**"];

export default defineWorkspace([
  {
    test: {
      name: "unit",
      include: ["packages/**/test/**/*.test.ts", "apps/**/test/**/*.test.ts"],
      exclude: [...exclude, "**/*.integration.test.ts"]
    }
  },
  {
    test: {
      name: "db-integration",
      include: ["packages/**/test/**/*.integration.test.ts", "apps/**/test/**/*.integration.test.ts"],
      exclude,
      pool: "forks",
      poolOptions: { forks: { singleFork: true } }
    }
  }
]);
