/**
 * E2E: Cron Endpoints
 *
 * Tests auto-checkout, renewal reminders, and re-engagement crons.
 *
 * Sprint 8 added requireCronSecret to all cron routes — they now need
 * Authorization: Bearer ${CRON_SECRET}. Tests use CronClient which sources
 * the secret from .env.local; whole suite skips cleanly if the env is unset.
 */
import { describe, it, expect } from "vitest";
import { CronClient } from "./helpers";

describe("Cron Endpoints", () => {
  const cron = new CronClient();
  const skipAll = !cron.isReady();
  const test = skipAll ? it.skip : it;

  test("auto-checkout returns success with count", async () => {
    const { status, body } = await cron.get("/api/cron/auto-checkout");
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(typeof body.closed).toBe("number");
  });

  test("renewal-reminders returns success with counts", async () => {
    const { status, body } = await cron.get("/api/cron/renewal-reminders");
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(typeof body.sent).toBe("number");
    // body.skipped may be a boolean (endpoint skipped) or number (skipped count)
    if (body.skipped === true) {
      expect(typeof body.reason).toBe("string");
    } else {
      expect(typeof body.skipped).toBe("number");
      expect(typeof body.birthdaySent).toBe("number");
    }
  });

  test("re-engagement returns counts", async () => {
    const { status, body } = await cron.get("/api/cron/re-engagement");
    expect(status).toBe(200);
    if (body.skipped === true) {
      expect(typeof body.reason).toBe("string");
    } else {
      expect(typeof body.sent).toBe("number");
      expect(typeof body.skipped).toBe("number");
    }
  });

  test("renewal-reminders is idempotent (same day re-run)", async () => {
    const first = await cron.get("/api/cron/renewal-reminders");
    const second = await cron.get("/api/cron/renewal-reminders");
    expect(second.status).toBe(200);
    // Second run should skip already-sent notifications (count fields only
    // present when the endpoint itself didn't short-circuit)
    if (first.body.skipped !== true && second.body.skipped !== true) {
      expect(second.body.skipped).toBeGreaterThanOrEqual(first.body.sent);
    }
  });
});
