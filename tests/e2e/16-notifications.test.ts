/**
 * E2E: Notifications, Bulk Notify, Segments
 */
import { describe, it, expect, beforeAll } from "vitest";
import { TestClient, AnonClient, SEED } from "./helpers";

describe("Notifications", () => {
  const admin = new TestClient();
  const staff = new TestClient();
  const member = new TestClient();

  beforeAll(async () => {
    await admin.login(SEED.admin.email, SEED.admin.password);
    await staff.login(SEED.staff.email, SEED.staff.password);
    await member.login(SEED.members.active20d.email, SEED.members.active20d.password);
  });

  describe("Notification Logs Page", () => {
    it("admin can access notifications page", async () => {
      const { status } = await admin.getPage("/admin/notifications");
      expect(status).toBe(200);
    });

    it("staff can access notifications page", async () => {
      const { status } = await staff.getPage("/admin/notifications");
      expect(status).toBe(200);
    });

    it("member cannot access notifications page", async () => {
      const { status } = await member.getPage("/admin/notifications");
      expect([302, 307]).toContain(status);
    });
  });

  describe("Bulk Notify Page", () => {
    it("admin can access bulk-notify page", async () => {
      const { status } = await admin.getPage("/admin/bulk-notify");
      expect(status).toBe(200);
    });

    it("staff can access bulk-notify page", async () => {
      const { status } = await staff.getPage("/admin/bulk-notify");
      expect(status).toBe(200);
    });

    it("member cannot access bulk-notify page", async () => {
      const { status } = await member.getPage("/admin/bulk-notify");
      expect([302, 307]).toContain(status);
    });
  });
});
