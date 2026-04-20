/**
 * E2E: Cron Automations
 *
 * Verifies all cron endpoints respond with 200 and valid JSON.
 * Complements the detailed tests in 03-cron.test.ts and
 * 50-cron-comprehensive.test.ts with a concise smoke-test suite.
 */
import { describe, it, expect } from "vitest";
import { CronClient } from "./helpers";

// Cron routes that don't require OPENAI_API_KEY at runtime.
const CRON_PATHS_NO_AI = [
  "/api/cron/auto-checkout",
  "/api/cron/renewal-reminders",
  "/api/cron/re-engagement",
  "/api/cron/member-milestones",
  "/api/cron/ai-lead-followup", // gated by setting; 200 with skipped:true when disabled
  "/api/cron/ai-member-nudges",
] as const;

// Cron routes that hit runProactiveAgent → @openai/agents directly — fail with
// 500 in environments where OPENAI_API_KEY is unset (local dev). Skipped when
// key missing. ai-weekly-summary is here because the IST timezone shift causes
// the "Only Mondays" guard to fall through on a UTC-Sunday late evening.
const CRON_PATHS_AI = [
  "/api/cron/ai-churn-alerts",
  "/api/cron/ai-daily-briefing",
  "/api/cron/ai-weekly-summary",
] as const;

describe("Cron Automations", () => {
  const cron = new CronClient();
  // Sprint 8 added requireCronSecret to all cron routes — these tests now
  // need the bearer token from .env.local. If CRON_SECRET is not set in the
  // test process, skip rather than report false 401 failures.
  const skipAll = !cron.isReady();
  const hasOpenAi = Boolean(process.env.OPENAI_API_KEY);

  for (const path of CRON_PATHS_NO_AI) {
    const name = path.replace("/api/cron/", "");
    (skipAll ? it.skip : it)(`${name} returns 200`, async () => {
      const { status, body } = await cron.get(path);
      expect(status).toBe(200);
      expect(typeof body).toBe("object");
      expect(body).not.toBeNull();
    });
  }

  for (const path of CRON_PATHS_AI) {
    const name = path.replace("/api/cron/", "");
    const skip = skipAll || !hasOpenAi;
    (skip ? it.skip : it)(`${name} returns 200`, async () => {
      const { status, body } = await cron.get(path);
      expect(status).toBe(200);
      expect(typeof body).toBe("object");
      expect(body).not.toBeNull();
    });
  }
});
