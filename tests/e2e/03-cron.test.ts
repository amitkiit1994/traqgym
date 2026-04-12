/**
 * E2E: Cron Endpoints
 *
 * Tests auto-checkout, renewal reminders, and re-engagement crons.
 */
import { describe, it, expect } from "vitest";
import { AnonClient } from "./helpers";

describe("Cron Endpoints", () => {
  const anon = new AnonClient();

  it("auto-checkout returns success with count", async () => {
    const { status, body } = await anon.get("/api/cron/auto-checkout");
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(typeof body.closed).toBe("number");
  });

  it("renewal-reminders returns success with counts", async () => {
    const { status, body } = await anon.get("/api/cron/renewal-reminders");
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(typeof body.sent).toBe("number");
    expect(typeof body.skipped).toBe("number");
    expect(typeof body.birthdaySent).toBe("number");
  });

  it("re-engagement returns counts", async () => {
    const { status, body } = await anon.get("/api/cron/re-engagement");
    expect(status).toBe(200);
    expect(typeof body.sent).toBe("number");
    expect(typeof body.skipped).toBe("number");
  });

  it("renewal-reminders is idempotent (same day re-run)", async () => {
    const first = await anon.get("/api/cron/renewal-reminders");
    const second = await anon.get("/api/cron/renewal-reminders");
    expect(second.status).toBe(200);
    // Second run should skip already-sent notifications
    expect(second.body.skipped).toBeGreaterThanOrEqual(first.body.sent);
  });
});
