/**
 * E2E: Dashboard, Reports, Activity Feed, P&L
 */
import { describe, it, expect, beforeAll } from "vitest";
import { TestClient, AnonClient, SEED } from "./helpers";

describe("Dashboard & Reports", () => {
  const admin = new TestClient();
  const staff = new TestClient();
  const member = new TestClient();
  const anon = new AnonClient();

  beforeAll(async () => {
    await admin.login(SEED.admin.email, SEED.admin.password);
    await staff.login(SEED.staff.email, SEED.staff.password);
    await member.login(SEED.members.active20d.email, SEED.members.active20d.password);
  });

  describe("Dashboard Page", () => {
    it("admin can access dashboard", async () => {
      const { status, html } = await admin.getPage("/admin/dashboard");
      expect(status).toBe(200);
      expect(html).toContain("dashboard");
    });

    it("staff can access dashboard", async () => {
      const { status } = await staff.getPage("/admin/dashboard");
      expect(status).toBe(200);
    });

    it("member cannot access dashboard", async () => {
      const { status } = await member.getPage("/admin/dashboard");
      expect([302, 307]).toContain(status);
    });

    it("anon is redirected from dashboard", async () => {
      const { status } = await anon.get("/admin/dashboard");
      expect([302, 307]).toContain(status);
    });
  });

  describe("Reports Page", () => {
    it("admin can access reports page", async () => {
      const { status } = await admin.getPage("/admin/reports");
      expect(status).toBe(200);
    });

    it("staff cannot access reports page (admin-only)", async () => {
      const { status } = await staff.getPage("/admin/reports");
      expect([302, 307]).toContain(status);
    });

    it("member cannot access reports page", async () => {
      const { status } = await member.getPage("/admin/reports");
      expect([302, 307]).toContain(status);
    });
  });

  describe("Activity Feed Page", () => {
    it("admin can access activity page", async () => {
      const { status } = await admin.getPage("/admin/activity");
      expect(status).toBe(200);
    });

    it("staff can access activity page", async () => {
      const { status } = await staff.getPage("/admin/activity");
      expect(status).toBe(200);
    });

    it("member cannot access activity page", async () => {
      const { status } = await member.getPage("/admin/activity");
      expect([302, 307]).toContain(status);
    });
  });

  describe("Audit Logs Page", () => {
    it("admin can access audit page", async () => {
      const { status } = await admin.getPage("/admin/audit");
      expect(status).toBe(200);
    });

    it("member cannot access audit page", async () => {
      const { status } = await member.getPage("/admin/audit");
      expect([302, 307]).toContain(status);
    });
  });

  describe("Staff Performance Page", () => {
    it("admin can access staff performance", async () => {
      const { status } = await admin.getPage("/admin/staff-performance");
      expect(status).toBe(200);
    });

    it("member cannot access staff performance", async () => {
      const { status } = await member.getPage("/admin/staff-performance");
      expect([302, 307]).toContain(status);
    });
  });

  describe("Worker Dashboard", () => {
    it("admin can access my-dashboard", async () => {
      const { status } = await admin.getPage("/admin/my-dashboard");
      expect(status).toBe(200);
    });

    it("staff can access my-dashboard", async () => {
      const { status } = await staff.getPage("/admin/my-dashboard");
      expect(status).toBe(200);
    });
  });
});
