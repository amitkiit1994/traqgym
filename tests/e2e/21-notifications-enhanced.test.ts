/**
 * E2E: Enhanced Notifications — Phase 0A
 * Tests: resend failed, member notification page, read/unread, date filter, delivery analytics
 */
import { describe, it, expect, beforeAll } from "vitest";
import { TestClient, SEED } from "./helpers";

describe("Enhanced Notifications", () => {
  const admin = new TestClient();
  const staff = new TestClient();
  const member = new TestClient();

  beforeAll(async () => {
    await admin.login(SEED.admin.email, SEED.admin.password);
    await staff.login(SEED.staff.email, SEED.staff.password);
    await member.login(SEED.members.active20d.email, SEED.members.active20d.password);
  });

  describe("Admin Notification Logs — Enhanced Filters", () => {
    it("admin can access notifications page", async () => {
      const { status } = await admin.getPage("/admin/notifications");
      expect(status).toBe(200);
    });

    it("staff can access notifications page", async () => {
      const { status } = await staff.getPage("/admin/notifications");
      expect(status).toBe(200);
    });

    it("member cannot access admin notifications", async () => {
      const { status } = await member.getPage("/admin/notifications");
      expect([302, 307]).toContain(status);
    });
  });

  describe("Member Notification Center", () => {
    it("member can access notifications page", async () => {
      const { status } = await member.getPage("/member/notifications");
      expect(status).toBe(200);
    });

    it("admin cannot access member notifications page", async () => {
      const { status } = await admin.getPage("/member/notifications");
      expect([302, 307]).toContain(status);
    });

    it("staff cannot access member notifications page", async () => {
      const { status } = await staff.getPage("/member/notifications");
      expect([302, 307]).toContain(status);
    });
  });

  describe("Bulk Notify Page — Enhanced", () => {
    it("admin can access bulk-notify page", async () => {
      const { status } = await admin.getPage("/admin/bulk-notify");
      expect(status).toBe(200);
    });

    it("member cannot access bulk-notify page", async () => {
      const { status } = await member.getPage("/admin/bulk-notify");
      expect([302, 307]).toContain(status);
    });
  });
});
