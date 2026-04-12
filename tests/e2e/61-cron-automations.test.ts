/**
 * E2E: Cron Automations
 *
 * Verifies all cron endpoints respond with 200 and valid JSON.
 * Complements the detailed tests in 03-cron.test.ts and
 * 50-cron-comprehensive.test.ts with a concise smoke-test suite.
 */
import { describe, it, expect } from "vitest";
import { AnonClient } from "./helpers";

const CRON_PATHS = [
  "/api/cron/auto-checkout",
  "/api/cron/renewal-reminders",
  "/api/cron/re-engagement",
  "/api/cron/member-milestones",
  "/api/cron/ai-churn-alerts",
  "/api/cron/ai-daily-briefing",
  "/api/cron/ai-lead-followup",
  "/api/cron/ai-member-nudges",
  "/api/cron/ai-weekly-summary",
] as const;

describe("Cron Automations", () => {
  const anon = new AnonClient();

  for (const path of CRON_PATHS) {
    const name = path.replace("/api/cron/", "");

    it(`${name} returns 200`, async () => {
      const { status, body } = await anon.get(path);
      expect(status).toBe(200);
      expect(typeof body).toBe("object");
      expect(body).not.toBeNull();
    });
  }
});
