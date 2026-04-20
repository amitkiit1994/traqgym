/**
 * vitest globalSetup — runs ONCE before any worker spawns.
 *
 * Idempotently upserts the demo SEED accounts/plans/tickets the e2e and
 * integration suites depend on, then writes them to tests/.seed-fixtures.json
 * which tests/e2e/helpers.ts reads synchronously at module load.
 *
 * This pattern lets the SEED demo data co-exist with imported FFF/EGYM
 * production-shape data instead of requiring a destructive `db:reset`.
 */
import { readFileSync } from "fs";
import path from "path";
import { PrismaClient } from "@prisma/client";
import { loadSeedFixtures, writeSeedFixturesJson } from "./helpers/seed-fixtures";

function loadDatabaseUrlFromEnvLocal(): void {
  if (process.env.DATABASE_URL) return;
  try {
    const envPath = path.resolve(process.cwd(), ".env.local");
    const content = readFileSync(envPath, "utf8");
    for (const rawLine of content.split("\n")) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      if (key !== "DATABASE_URL") continue;
      let val = line.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      process.env.DATABASE_URL = val;
      return;
    }
  } catch {
    // .env.local optional — fixture loader will fail loudly if DATABASE_URL is unset
  }
}

export async function setup() {
  loadDatabaseUrlFromEnvLocal();
  if (!process.env.DATABASE_URL) {
    console.warn("[global-setup] DATABASE_URL not set — skipping fixture upsert");
    return;
  }
  const prisma = new PrismaClient();
  try {
    const seed = await loadSeedFixtures(prisma);
    writeSeedFixturesJson(seed);
    console.log(
      `[global-setup] SEED fixtures upserted (admin#${seed.admin.id}, members ${seed.members.active20d.id}-${seed.members.noTicket.id}, plans ${seed.plans.monthly.id}/${seed.plans.quarterly.id}/${seed.plans.annual.id})`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

export async function teardown() {
  // Fixtures intentionally retained — they're idempotent and used across runs.
}
