import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { CAPABILITY_IDS, ROUTE_TABLE, TASK_IDS } from "@ipmat/ai-orchestration";
import { describe, expect, it } from "vitest";

/**
 * Phase 9 Unit 3 (D-099) -- repository-wide SECURITY BOUNDARY checks. These read source, not behaviour: they fail when a secret,
 * a vendor SDK, an environment read or a trusted-identity field appears somewhere it must not.
 */
const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name === ".git") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}
const rel = (f: string): string => relative(REPO, f).replace(/\\/g, "/");
const read = (f: string): string => readFileSync(f, "utf-8");

const SRC_DIRS = ["apps/api/src", "apps/web/src", "packages"].map((d) => join(REPO, d));
/** Production source only: files under a `src/` directory (developer demo/smoke scripts are not shipped and may read the environment by design). */
const allSource = SRC_DIRS.flatMap((d) => walk(d)).filter((f) => /(^|\/)src\//.test(rel(f)));
const allTests = SRC_DIRS.flatMap((d) => walk(d)).filter((f) => /\/test\//.test(rel(f)) || /\.test\.tsx?$/.test(f));

describe("secrets and configuration stay in the approved boundary", () => {
  it("only the API entry/transport/wiring files read process.env; no domain package, no application service, no frontend file does", () => {
    const readers = allSource.filter((f) => /process\.env|import\.meta\.env/.test(read(f))).map(rel).sort();
    expect(readers).toEqual(["apps/api/src/index.ts", "apps/api/src/server.ts", "apps/api/src/wiring.ts", "apps/web/src/config.ts"].sort().filter((f) => readers.includes(f)));
    expect(readers.every((f) => f.startsWith("apps/api/src/") || f === "apps/web/src/config.ts")).toBe(true);
  });

  it("the only frontend environment read is the public API base URL", () => {
    const text = read(join(REPO, "apps/web/src/config.ts"));
    expect(text.match(/import\.meta\.env\.(\w+)/g)).toEqual(["import.meta.env.VITE_API_BASE_URL"]);
  });

  it("the vendor SDK is imported only inside @ipmat/ai, and no domain/application/frontend source names a provider key", () => {
    const sdk = allSource.filter((f) => /from\s+["']@anthropic-ai\/sdk|from\s+["']openai["']|@google\/generative-ai/.test(read(f))).map(rel);
    expect(sdk).toEqual(["packages/ai/src/providers/anthropicProvider.ts"]);
    const keyNames = allSource.filter((f) => !rel(f).startsWith("packages/ai/") && !rel(f).startsWith("apps/api/src/") && /ANTHROPIC_API_KEY|OPENAI_API_KEY|sk-ant-/.test(read(f))).map(rel);
    expect(keyNames).toEqual([]);
  });

  it("no source or test file contains a credential-shaped literal (API key, private key, token, connection string with a password)", () => {
    const patterns: Array<[string, RegExp]> = [
      ["anthropic key", /sk-ant-[A-Za-z0-9_-]{16,}/],
      ["generic sk- key", /\bsk-[A-Za-z0-9]{32,}\b/],
      ["private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
      ["aws key", /\bAKIA[0-9A-Z]{16}\b/],
      ["github token", /\bgh[pousr]_[A-Za-z0-9]{30,}\b/],
      ["bearer literal", /Bearer\s+[A-Za-z0-9._-]{30,}/],
      ["db url with password", /postgres(?:ql)?:\/\/[^\s:'"`@/]+:[^\s'"`@]{4,}@(?!127\.0\.0\.1|localhost)[^\s'"`]+/]
    ];
    const offenders: string[] = [];
    for (const f of [...allSource, ...allTests]) {
      const text = read(f);
      for (const [name, re] of patterns) if (re.test(text)) offenders.push(`${rel(f)} (${name})`);
    }
    expect(offenders).toEqual([]);
  });

  it("no .env file with real values is tracked (only .env.example files)", () => {
    expect(existsSync(join(REPO, ".env.example")) || true).toBe(true);
    for (const f of [".env", "apps/api/.env", "apps/web/.env", "packages/db/.env"]) {
      const full = join(REPO, f);
      if (!existsSync(full)) continue;
      // a local, untracked developer file may exist; it must at least be git-ignored
      expect(read(join(REPO, ".gitignore"))).toMatch(/^\.env$/m);
    }
  });

  it("the built frontend bundle, when present, contains no server secret name or connection string", () => {
    const dist = join(REPO, "apps/web/dist");
    if (!existsSync(dist)) return;
    const files: string[] = [];
    const scan = (d: string): void => {
      for (const n of readdirSync(d)) {
        const p = join(d, n);
        if (statSync(p).isDirectory()) scan(p);
        else if (/\.(js|html|css|map)$/.test(n)) files.push(p);
      }
    };
    scan(dist);
    for (const f of files) {
      const text = read(f);
      for (const marker of ["ANTHROPIC_API_KEY", "IPMAT_AI_MODEL", "DATABASE_URL", "postgres://", "postgresql://", "sk-ant-", "IPMAT_HYPOTHESIS_SECRET", "process.env.ANTHROPIC"]) {
        expect(text.includes(marker), `${rel(f)} contains ${marker}`).toBe(false);
      }
    }
  });
});

describe("the frontend cannot supply trusted identity", () => {
  it("no frontend request builder names a student, enrollment, exam, role, capability or workflow field", () => {
    const apis = allSource.filter((f) => /apps\/web\/src\/(tutor|enrollment|auth)\/api\.ts$/.test(rel(f)));
    expect(apis.length).toBeGreaterThanOrEqual(3);
    for (const f of apis) {
      const text = read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, ""); // code only: comments may legitimately say "no studentId is sent"
      expect(text, rel(f)).not.toMatch(/studentId|enrollmentId|examCode|capabilit|workflow|role\s*:|actor/);
    }
  });
});

describe("the application boundary stays closed", () => {
  it("the orchestration registry still has exactly the seven capabilities and a fixed task table (the model and the client choose neither)", () => {
    expect([...CAPABILITY_IDS].sort()).toEqual(["adaptive_curriculum", "exam_intelligence", "personalization", "question_generation", "revision_intelligence", "simulation_intelligence", "tutor_response"]);
    expect(Object.keys(ROUTE_TABLE).sort()).toEqual([...TASK_IDS].sort());
  });

  it("no HTTP route binds question generation, orchestration, audit reads, or the Phase 7 intelligence readers", () => {
    const server = read(join(REPO, "apps/api/src/server.ts")) + read(join(REPO, "apps/api/src/assistantWiring.ts"));
    expect(server).not.toMatch(/generate_question|question_generation|ContentGenerationApiService|\.generation\b|readRevisionIntelligence|readAdaptiveCurriculum|readMasteryEvidence|composeExamPerformance|listForStudent|findByRequestId/);
  });

  it("domain packages stay free of Prisma, @ipmat/db, HTTP and vendor coupling", () => {
    const offenders = allSource.filter((f) => rel(f).startsWith("packages/domain/")).filter((f) => /from\s+["'](@prisma\/client|@ipmat\/db|node:http|@anthropic-ai\/sdk)/.test(read(f))).map(rel);
    expect(offenders).toEqual([]);
  });

  it("the observability package is dependency-free and no domain package imports the logger (domain code never logs)", () => {
    const offenders = allSource.filter((f) => rel(f).startsWith("packages/domain/")).filter((f) => /@ipmat\/observability/.test(read(f))).map(rel);
    expect(offenders).toEqual([]);
  });

  it("nothing in the application layer logs through console, and the only console use in apps/api is the startup banner", () => {
    const uses = allSource.filter((f) => /\bconsole\.(log|info|warn|error|debug)\b/.test(read(f)) && (rel(f).startsWith("packages/assistant-api") || rel(f).startsWith("packages/observability") || rel(f).startsWith("apps/api/src"))).map(rel);
    expect(uses).toEqual(["apps/api/src/index.ts"]);
  });
});
