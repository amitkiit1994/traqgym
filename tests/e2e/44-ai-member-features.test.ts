/**
 * E2E: AI Member Features
 *
 * Tests member-facing AI cron endpoints: nudges, milestones.
 *
 * Sprint 8 added requireCronSecret to all cron routes — admin sessions no
 * longer get 200 from these endpoints. Use CronClient with the bearer token
 * from .env.local. Whole suite skips cleanly when CRON_SECRET is unset.
 */
import { describe, it, expect } from "vitest";
import { CronClient } from "./helpers";

describe("AI Member Features", () => {
  const cron = new CronClient();
  const test = cron.isReady() ? it : it.skip;

  describe("Member Nudges Cron", () => {
    test("returns 200", async () => {
      const { status, body } = await cron.get("/api/cron/ai-member-nudges");
      expect(status).toBe(200);
      expect(body.success).toBe(true);
    });

    test("returns valid response shape", async () => {
      const { body } = await cron.get("/api/cron/ai-member-nudges");
      expect(body).toHaveProperty("success");
      if (!body.skipped) {
        expect(body).toHaveProperty("eligible");
        expect(body).toHaveProperty("sent");
      }
    });
  });

  describe("Member Milestones Cron", () => {
    test("returns 200", async () => {
      const { status, body } = await cron.get("/api/cron/member-milestones");
      expect(status).toBe(200);
      expect(body.success).toBe(true);
    });

    test("returns valid response shape", async () => {
      const { body } = await cron.get("/api/cron/member-milestones");
      expect(body).toHaveProperty("success");
      if (!body.skipped) {
        expect(body).toHaveProperty("milestones");
      }
    });
  });

  describe("Renewal Reminders (with smart renewal)", () => {
    test("returns 200", async () => {
      const { status, body } = await cron.get("/api/cron/renewal-reminders");
      expect(status).toBe(200);
      expect(body.success).toBe(true);
    });

    test("includes aiRenewalSent in response", async () => {
      const { body } = await cron.get("/api/cron/renewal-reminders");
      // aiRenewalSent only present when the endpoint actually executed.
      // If the route short-circuited (skipped:true), it omits the field.
      if (body.skipped !== true) {
        expect(body).toHaveProperty("aiRenewalSent");
      }
    });
  });
});
