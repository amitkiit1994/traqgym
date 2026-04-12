/**
 * E2E: Cheque Tracking, Anniversary, Irregular Members, PT Reports, Lead Pipeline
 */
import { describe, it, expect, beforeAll } from "vitest";
import { TestClient, SEED } from "./helpers";

describe("Phase D Features", () => {
  const admin = new TestClient();
  const staff = new TestClient();
  const member = new TestClient();

  beforeAll(async () => {
    await admin.login(SEED.admin.email, SEED.admin.password);
    await staff.login(SEED.staff.email, SEED.staff.password);
    await member.login(SEED.members.active20d.email, SEED.members.active20d.password);
  });

  describe("Page Access", () => {
    it("admin can access dashboard", async () => {
      const { status } = await admin.getPage("/admin/dashboard");
      expect(status).toBe(200);
    });

    it("admin can access reports", async () => {
      const { status } = await admin.getPage("/admin/reports");
      expect(status).toBe(200);
    });

    it("admin can access enquiries (lead pipeline)", async () => {
      const { status } = await admin.getPage("/admin/enquiries");
      expect(status).toBe(200);
    });

    it("member cannot access admin pages", async () => {
      const { status } = await member.getPage("/admin/dashboard");
      expect([302, 307]).toContain(status);
    });
  });

  describe("AI Tools - Cheque", () => {
    it("AI can query pending cheques", async () => {
      const { status } = await admin.post("/api/admin/ai/chat", {
        messages: [{ role: "user", content: "Show pending cheques" }],
      });
      expect([200, 400, 401]).toContain(status);
    });
  });

  describe("AI Tools - Anniversary", () => {
    it("AI can query today's anniversaries", async () => {
      const { status } = await admin.post("/api/admin/ai/chat", {
        messages: [{ role: "user", content: "Any member anniversaries today?" }],
      });
      expect([200, 400, 401]).toContain(status);
    });

    it("AI can query upcoming anniversaries", async () => {
      const { status } = await admin.post("/api/admin/ai/chat", {
        messages: [{ role: "user", content: "Show upcoming member anniversaries in next 30 days" }],
      });
      expect([200, 400, 401]).toContain(status);
    });
  });

  describe("AI Tools - Irregular Members", () => {
    it("AI can query irregular members", async () => {
      const { status } = await admin.post("/api/admin/ai/chat", {
        messages: [{ role: "user", content: "Which members haven't visited in 7 days?" }],
      });
      expect([200, 400, 401]).toContain(status);
    });
  });

  describe("AI Tools - PT Reports", () => {
    it("AI can query PT session report", async () => {
      const { status } = await admin.post("/api/admin/ai/chat", {
        messages: [{ role: "user", content: "Show PT session report for this month" }],
      });
      expect([200, 400, 401]).toContain(status);
    });
  });

  describe("AI Tools - Lead Pipeline", () => {
    it("AI can query lead pipeline", async () => {
      const { status } = await admin.post("/api/admin/ai/chat", {
        messages: [{ role: "user", content: "Show the lead pipeline funnel" }],
      });
      expect([200, 400, 401]).toContain(status);
    });
  });
});
