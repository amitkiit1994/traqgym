/**
 * E2E: AI Member Features
 *
 * Tests member-facing AI cron endpoints: nudges, milestones.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { TestClient, SEED } from "./helpers";

describe("AI Member Features", () => {
  const admin = new TestClient();

  beforeAll(async () => {
    await admin.login(SEED.admin.email, SEED.admin.password);
  });

  describe("Member Nudges Cron", () => {
    it("returns 200", async () => {
      const { status, body } = await admin.get("/api/cron/ai-member-nudges");
      expect(status).toBe(200);
      expect(body.success).toBe(true);
    });

    it("returns valid response shape", async () => {
      const { body } = await admin.get("/api/cron/ai-member-nudges");
      expect(body).toHaveProperty("success");
      if (!body.skipped) {
        expect(body).toHaveProperty("eligible");
        expect(body).toHaveProperty("sent");
      }
    });
  });

  describe("Member Milestones Cron", () => {
    it("returns 200", async () => {
      const { status, body } = await admin.get("/api/cron/member-milestones");
      expect(status).toBe(200);
      expect(body.success).toBe(true);
    });

    it("returns valid response shape", async () => {
      const { body } = await admin.get("/api/cron/member-milestones");
      expect(body).toHaveProperty("success");
      if (!body.skipped) {
        expect(body).toHaveProperty("milestones");
      }
    });
  });

  describe("Renewal Reminders (with smart renewal)", () => {
    it("returns 200", async () => {
      const { status, body } = await admin.get("/api/cron/renewal-reminders");
      expect(status).toBe(200);
      expect(body.success).toBe(true);
    });

    it("includes aiRenewalSent in response", async () => {
      const { body } = await admin.get("/api/cron/renewal-reminders");
      // aiRenewalSent is present (0 if disabled by default)
      expect(body).toHaveProperty("aiRenewalSent");
    });
  });
});
