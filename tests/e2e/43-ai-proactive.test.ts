/**
 * E2E: AI Proactive Features
 *
 * Tests the cron endpoints for daily briefing, churn alerts, and lead follow-up.
 * Note: These tests verify the cron endpoints return valid responses.
 * AI generation requires OPENAI_API_KEY — tests validate structure, not AI output.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { TestClient, AnonClient, SEED } from "./helpers";

describe("AI Proactive Features", () => {
  const admin = new TestClient();
  const staff = new TestClient();
  const member = new TestClient();
  const anon = new AnonClient();

  beforeAll(async () => {
    await admin.login(SEED.admin.email, SEED.admin.password);
    await staff.login(SEED.staff.email, SEED.staff.password);
    await member.login(SEED.members.active20d.email, SEED.members.active20d.password);
  });

  describe("Daily Briefing Cron", () => {
    it("returns 200 for admin", async () => {
      const { status, body } = await admin.get("/api/cron/ai-daily-briefing");
      expect(status).toBe(200);
      expect(body.success).toBe(true);
    });

    it("returns valid response shape", async () => {
      const { body } = await admin.get("/api/cron/ai-daily-briefing");
      expect(body).toHaveProperty("success");
      // Either sent + briefingLength or skipped + reason
      if (!body.skipped) {
        expect(body).toHaveProperty("sent");
      }
    });
  });

  describe("Churn Alerts Cron", () => {
    it("returns 200 for admin", async () => {
      const { status, body } = await admin.get("/api/cron/ai-churn-alerts");
      expect(status).toBe(200);
      expect(body.success).toBe(true);
    });

    it("returns valid response shape", async () => {
      const { body } = await admin.get("/api/cron/ai-churn-alerts");
      expect(body).toHaveProperty("success");
      if (!body.skipped) {
        expect(body).toHaveProperty("atRisk");
      }
    });
  });

  describe("Lead Follow-up Cron", () => {
    it("returns 200 for admin", async () => {
      const { status, body } = await admin.get("/api/cron/ai-lead-followup");
      expect(status).toBe(200);
      expect(body.success).toBe(true);
    });

    it("returns valid response shape", async () => {
      const { body } = await admin.get("/api/cron/ai-lead-followup");
      expect(body).toHaveProperty("success");
      if (!body.skipped) {
        expect(body).toHaveProperty("processed");
      }
    });
  });

  describe("Weekly Summary Cron", () => {
    it("returns 200 for admin", async () => {
      const { status, body } = await admin.get("/api/cron/ai-weekly-summary");
      expect(status).toBe(200);
      expect(body.success).toBe(true);
    });
  });

  describe("AI Draft Follow-up Endpoint", () => {
    it("returns draft for enquiry", async () => {
      const { status, body } = await admin.post("/api/admin/ai/draft-followup", {
        type: "enquiry",
        id: SEED.enquiries.new.id,
      });
      // 200 if OPENAI_API_KEY is set, or may error without it
      expect([200, 500]).toContain(status);
      if (status === 200) {
        expect(body).toHaveProperty("draft");
      }
    });

    it("rejects invalid type", async () => {
      const { status } = await admin.post("/api/admin/ai/draft-followup", {
        type: "invalid",
        id: 1,
      });
      expect(status).toBe(400);
    });

    it("rejects missing params", async () => {
      const { status } = await admin.post("/api/admin/ai/draft-followup", {});
      expect(status).toBe(400);
    });

    it("member cannot access draft endpoint", async () => {
      const { status } = await member.post("/api/admin/ai/draft-followup", {
        type: "enquiry",
        id: 1,
      });
      expect([401, 302, 307]).toContain(status);
    });
  });
});
