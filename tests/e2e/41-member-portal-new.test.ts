/**
 * E2E: New Member Portal Pages
 */
import { describe, it, expect, beforeAll } from "vitest";
import { TestClient, SEED } from "./helpers";

describe("New Member Portal Pages", () => {
  const admin = new TestClient();
  const member = new TestClient();

  beforeAll(async () => {
    await admin.login(SEED.admin.email, SEED.admin.password);
    await member.login(SEED.members.active20d.email, SEED.members.active20d.password);
  });

  describe("Member Portal Pages", () => {
    it("member can access announcements page", async () => {
      const { status } = await member.getPage("/member/announcements");
      expect(status).toBe(200);
    });

    it("member can access referrals page", async () => {
      const { status } = await member.getPage("/member/referrals");
      expect(status).toBe(200);
    });

    it("member can access waivers page", async () => {
      const { status } = await member.getPage("/member/waivers");
      expect(status).toBe(200);
    });

    it("member can access workout page", async () => {
      const { status } = await member.getPage("/member/workout");
      expect(status).toBe(200);
    });

    it("member can access diet page", async () => {
      const { status } = await member.getPage("/member/diet");
      expect(status).toBe(200);
    });

    it("member can access bookings page", async () => {
      const { status } = await member.getPage("/member/bookings");
      expect(status).toBe(200);
    });
  });

  describe("Auth Guards", () => {
    it("member cannot access admin dashboard", async () => {
      const { status } = await member.getPage("/admin/dashboard");
      expect([302, 307]).toContain(status);
    });

    it("member cannot access admin members page", async () => {
      const { status } = await member.getPage("/admin/members");
      expect([302, 307]).toContain(status);
    });
  });
});
