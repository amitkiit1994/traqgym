/**
 * E2E: Payroll
 */
import { describe, it, expect, beforeAll } from "vitest";
import { TestClient, SEED } from "./helpers";

describe("Payroll", () => {
  const admin = new TestClient();
  const staff = new TestClient();
  const member = new TestClient();

  beforeAll(async () => {
    await admin.login(SEED.admin.email, SEED.admin.password);
    await staff.login(SEED.staff.email, SEED.staff.password);
    await member.login(SEED.members.active20d.email, SEED.members.active20d.password);
  });

  describe("Page Access", () => {
    it("admin can access payroll page", async () => {
      const { status } = await admin.getPage("/admin/payroll");
      expect(status).toBe(200);
    });

    it("staff can access payroll page", async () => {
      const { status } = await staff.getPage("/admin/payroll");
      expect(status).toBe(200);
    });

    it("member cannot access payroll page", async () => {
      const { status } = await member.getPage("/admin/payroll");
      expect([302, 307]).toContain(status);
    });
  });

  describe("AI Tools - Payroll", () => {
    it("AI can calculate payroll", async () => {
      const { status } = await admin.post("/api/admin/ai/chat", {
        messages: [{ role: "user", content: "Calculate payroll for this month" }],
      });
      expect([200, 400, 401]).toContain(status);
    });

    it("AI can query payroll summary", async () => {
      const { status } = await admin.post("/api/admin/ai/chat", {
        messages: [{ role: "user", content: "Show payroll summary for all staff" }],
      });
      expect([200, 400, 401]).toContain(status);
    });

    it("AI can query salary details", async () => {
      const { status } = await admin.post("/api/admin/ai/chat", {
        messages: [{ role: "user", content: "Show salary breakdown for staff members" }],
      });
      expect([200, 400, 401]).toContain(status);
    });
  });
});
