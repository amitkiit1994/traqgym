import { vi } from "vitest";
import { readFileSync } from "fs";
import path from "path";

// Inline .env.local loader (avoids adding dotenv as a dependency just for tests).
// Only mirrors a small allowlist of secrets the test process needs to talk to
// the running dev server — specifically the cron Bearer secret added in Sprint 8.
// We intentionally do NOT mirror NEXTAUTH_URL or DATABASE_URL: those would
// override the test runner's chosen URLs and break suites that point at a
// different port (e.g. e2e tests use BASE_URL/TEST_BASE_URL, not NEXTAUTH_URL).
const ENV_ALLOWLIST = ["CRON_SECRET", "MANAGER_ACTION_SECRET", "OPENAI_API_KEY"];
function loadEnvLocal() {
  try {
    const envPath = path.resolve(process.cwd(), ".env.local");
    const content = readFileSync(envPath, "utf8");
    for (const rawLine of content.split("\n")) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      if (!ENV_ALLOWLIST.includes(key)) continue;
      let val = line.slice(eq + 1).trim();
      // Strip surrounding quotes if present
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = val;
    }
  } catch {
    // .env.local optional — tests that need its values will skip cleanly
  }
}
loadEnvLocal();

// Mock next/cache so server actions/services that wrap functions with
// `unstable_cache` (or call `revalidatePath`/`revalidateTag`) can be imported
// in a plain Node/vitest context without throwing
// "An attempted call to unstable_cache failed" errors.
vi.mock("next/cache", () => ({
  unstable_cache: <T extends (...args: any[]) => any>(fn: T) => fn,
  unstable_noStore: () => {},
  revalidatePath: () => {},
  revalidateTag: () => {},
}));
