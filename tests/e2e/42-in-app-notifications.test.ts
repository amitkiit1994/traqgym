/**
 * E2E: In-App Notifications
 */
import { describe, it, expect, beforeAll } from "vitest";
import { TestClient, SEED } from "./helpers";

describe("In-App Notifications", () => {
  const admin = new TestClient();
  const staff = new TestClient();
  const member = new TestClient();

  beforeAll(async () => {
    await admin.login(SEED.admin.email, SEED.admin.password);
    await staff.login(SEED.staff.email, SEED.staff.password);
    await member.login(SEED.members.active20d.email, SEED.members.active20d.password);
  });

  describe("Admin/Staff Page Access", () => {
    it("admin can access in-app notifications page", async () => {
      const { status } = await admin.getPage("/admin/in-app-notifications");
      expect(status).toBe(200);
    });

    it("staff can access in-app notifications page", async () => {
      const { status } = await staff.getPage("/admin/in-app-notifications");
      expect(status).toBe(200);
    });
  });

  describe("Member Page Access", () => {
    it("member can access in-app notifications page", async () => {
      const { status } = await member.getPage("/member/in-app-notifications");
      expect(status).toBe(200);
    });

    it("member cannot access admin in-app notifications", async () => {
      const { status } = await member.getPage("/admin/in-app-notifications");
      expect([302, 307]).toContain(status);
    });
  });
});
