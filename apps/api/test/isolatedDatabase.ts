import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createPrismaClient } from "@ipmat/db";

/**
 * Creates a THROWAWAY database next to the configured test database (its name derives from the configured one, so it still contains "test"),
 * applies the migrations and the seed, and hands back its URL plus a `drop()`. Integration suites that need to publish synthetic TEST DATA
 * use this so they never touch the shared test database that other suites assume holds exactly the seeded published set.
 */
export async function createIsolatedDatabase(adminUrl: string, label: string): Promise<{ url: string; name: string; drop: () => Promise<void> }> {
  const base = new URL(adminUrl);
  const name = `${base.pathname.replace(/^\//, "")}_${label}_${randomUUID().slice(0, 8)}`;
  const admin = createPrismaClient(adminUrl);
  await admin.$connect();
  await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
  await admin.$disconnect();

  const target = new URL(adminUrl);
  target.pathname = `/${name}`;
  const url = target.toString();
  const dbPackage = fileURLToPath(new URL("../../../packages/db", import.meta.url));
  const env = { ...process.env, DATABASE_URL: url };
  execSync("npx prisma migrate deploy", { cwd: dbPackage, env, stdio: "ignore" });
  execSync("npx tsx prisma/seed.ts", { cwd: dbPackage, env, stdio: "ignore" });

  return {
    url,
    name,
    drop: async () => {
      const dropper = createPrismaClient(adminUrl);
      await dropper.$connect();
      await dropper.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      await dropper.$disconnect();
    }
  };
}
