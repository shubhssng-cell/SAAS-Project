import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Phase 9 Unit 4 (docs/DECISIONS.md D-100) -- repository-wide COMMERCIAL BOUNDARY checks. They read source, not behaviour: they fail
 * when payment logic, a price, a secret or an entitlement decision shows up somewhere it must not.
 */
const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name === ".git") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|sql|prisma)$/.test(name)) out.push(full);
  }
  return out;
}
const rel = (f: string): string => relative(REPO, f).replace(/\\/g, "/");
const read = (f: string): string => readFileSync(f, "utf-8");
const stripComments = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const productionSource = ["apps/api/src", "apps/web/src", "packages"].flatMap((d) => walk(join(REPO, d))).filter((f) => /(^|\/)src\//.test(rel(f)));

describe("the commercial layer stays out of everything it must not touch", () => {
  const allowedImporters = (f: string): boolean => rel(f).startsWith("packages/domain/billing/") || rel(f).startsWith("packages/billing-api/") || rel(f).startsWith("packages/db/") || rel(f).startsWith("apps/api/");

  it("only the billing packages, the persistence package and the API import the billing packages: no intelligence engine, training system, tutor, practice service or web file does", () => {
    const offenders = productionSource.filter((f) => !allowedImporters(f) && /from\s+["']@ipmat\/billing(-api)?(\/[^"']*)?["']/.test(read(f))).map(rel);
    expect(offenders).toEqual([]);
  });

  it("no package depends on the billing packages in package.json except the persistence layer, the API and the billing application layer", () => {
    const manifests = ["packages", "packages/domain", "apps"].flatMap((d) => readdirSync(join(REPO, d)).map((n) => join(REPO, d, n, "package.json"))).filter((f) => existsSync(f));
    const declares = (f: string): boolean => {
      const json = JSON.parse(read(f)) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
      return ["@ipmat/billing", "@ipmat/billing-api"].some((n) => n in (json.dependencies ?? {}) || n in (json.devDependencies ?? {}));
    };
    const dependents = manifests.filter(declares).map(rel).sort();
    expect(dependents).toEqual(["apps/api/package.json", "packages/billing-api/package.json", "packages/db/package.json"].sort());
  });

  it("the billing domain is pure: no Prisma, no database package, no HTTP, no vendor SDK, no environment, and no clock read (time is always injected)", () => {
    const files = walk(join(REPO, "packages/domain/billing/src"));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const text = stripComments(read(f));
      expect(text, rel(f)).not.toMatch(/from\s+["'](@prisma\/client|@ipmat\/db|node:http|node:https|stripe|razorpay|@anthropic-ai\/sdk)["']/);
      expect(text, rel(f)).not.toMatch(/process\.env|import\.meta\.env/);
      expect(text, rel(f)).not.toMatch(/Date\.now\s*\(|new Date\s*\(\s*\)/);
    }
  });

  it("the billing application layer imports no database, Prisma, HTTP framework, vendor SDK or environment", () => {
    for (const f of walk(join(REPO, "packages/billing-api/src")).filter((x) => !x.endsWith("testing.ts"))) {
      const text = stripComments(read(f));
      expect(text, rel(f)).not.toMatch(/from\s+["'](@prisma\/client|@ipmat\/db|node:http|node:https|stripe|razorpay)["']/);
      expect(text, rel(f)).not.toMatch(/process\.env|import\.meta\.env/);
    }
  });

  it("the payment-provider test double is never part of the public entry point or of production wiring", () => {
    expect(read(join(REPO, "packages/billing-api/src/index.ts"))).not.toMatch(/testing/);
    const importers = productionSource.filter((f) => /billing-api\/testing|from\s+["']\.\/testing\.js["']/.test(read(f))).map(rel);
    expect(importers).toEqual([]);
    expect(read(join(REPO, "apps/api/src/commerceWiring.ts"))).toMatch(/PAYMENT_PROVIDER_ADAPTERS: Readonly<Record<string, PaymentProviderFactory>> = Object\.freeze\(\{\}\)/);
  });

  it("no provider SDK or provider secret appears anywhere in production source (no adapter has been chosen)", () => {
    const offenders = productionSource.filter((f) => /from\s+["'](stripe|razorpay|@stripe\/[^"']+|paypal[^"']*)["']|whsec_[A-Za-z0-9]{8,}|sk_(live|test)_[A-Za-z0-9]{8,}|rzp_(live|test)_[A-Za-z0-9]{6,}/.test(read(f))).map(rel);
    expect(offenders).toEqual([]);
  });

  it("no plan identifier or price is compared or hard-coded in production source: plans are configuration, not conditionals", () => {
    const offenders: string[] = [];
    for (const f of productionSource) {
      const text = stripComments(read(f));
      if (/(?<!typeof\s+)\bplan(Id|Name)?\s*[!=]==?\s*["'`]/.test(text) || /["'`]\s*[!=]==?\s*(\w+\.)?plan(Id|Name)?\b/.test(text)) offenders.push(`${rel(f)} (plan comparison)`);
      if (/\b(IPMAT_PRO|ipmat_pro|premium_plan|pro_plan|PREMIUM|FREE_PLAN)\b/.test(text)) offenders.push(`${rel(f)} (named plan)`);
    }
    expect(offenders).toEqual([]);
  });

  it("the frontend contains no amount, currency, price, provider name, secret or entitlement decision of its own", () => {
    const web = walk(join(REPO, "apps/web/src"));
    const offenders: string[] = [];
    for (const f of web) {
      const text = stripComments(read(f));
      if (/[{,]\s*(amountMinor|price|amount)\s*:\s*\d|\b(amountMinor|price|amount)\s*=\s*\d|[{,]\s*(currency)\s*:\s*["'](INR|USD|EUR)/.test(text)) offenders.push(`${rel(f)} (hard-coded price)`);
      if (/stripe|razorpay|paypal|whsec_|sk_live|cvv|card\s*number/i.test(text)) offenders.push(`${rel(f)} (payment provider / card data)`);
      if (/localStorage|sessionStorage/.test(text) && /entitle|subscription|billing|plan/i.test(text.match(/(localStorage|sessionStorage)[^\n]*/g)?.join("\n") ?? "")) offenders.push(`${rel(f)} (billing state in browser storage)`);
    }
    expect(offenders).toEqual([]);
  });

  it("the server never reads billing state itself: it consults only the guard, the billing service and the webhook", () => {
    const text = stripComments(read(join(REPO, "apps/api/src/server.ts")));
    expect(text).not.toMatch(/EntitlementService|UsageService|BillingStore|UsageStore|listSubscriptionsForStudent|grantsAccess|effectiveStatus|applyBillingEvent/);
    expect(text).toMatch(/deps\.commerce/);
  });

  it("the tutor, practice and training application packages know nothing of billing (commercial rules do not invade the engines)", () => {
    for (const dir of ["packages/assistant-api/src", "packages/practice-api/src", "packages/training-recommendation/src", "packages/practice-loop/src", "packages/auth-api/src", "packages/enrollment-api/src"]) {
      for (const f of walk(join(REPO, dir))) expect(stripComments(read(f)), rel(f)).not.toMatch(/entitle|subscription|billing|checkout|usage_limit/i);
    }
  });
});

describe("migration 0018 is additive and holds no payment secrets", () => {
  const sql = read(join(REPO, "packages/db/prisma/migrations/0018_monetization_entitlements/migration.sql"));
  const body = sql.replace(/--.*$/gm, "");
  const NEW_TABLES = ["billing_subscriptions", "billing_events", "usage_events", "ai_usage_records"];

  it("only creates new tables and touches no existing one", () => {
    expect([...body.matchAll(/CREATE TABLE "(\w+)"/g)].map((m) => m[1]).sort()).toEqual([...NEW_TABLES].sort());
    for (const m of body.matchAll(/ALTER TABLE "(\w+)"/g)) expect(NEW_TABLES, m[1]).toContain(m[1]);
    expect(body).not.toMatch(/DROP\s+(TABLE|COLUMN|CONSTRAINT)|DELETE\s+FROM|TRUNCATE|UPDATE\s+"?\w+"?\s+SET|ALTER\s+COLUMN|RENAME/i);
    expect(body).not.toMatch(/INSERT\s+INTO/i);
  });

  it("stores no card, bank, customer, payload or signature column", () => {
    const columns = [...body.matchAll(/^\s+"(\w+)"\s+(?:TEXT|INTEGER|TIMESTAMP|BOOLEAN|JSONB)/gm)].map((m) => m[1]!);
    expect(columns.length).toBeGreaterThan(20);
    expect(columns.filter((c) => /card|cvv|cvc|iban|account_number|secret|signature|payload|email|phone|address|prompt|response|answer|^name$|token$/i.test(c))).toEqual([]);
  });
});
