/**
 * E2E: Announcements, Referrals, Measurements, Birthdays, Freeze
 */
import { describe, it, expect, beforeAll } from "vitest";
import { TestClient, AnonClient, SEED } from "./helpers";

describe("Misc Features", () => {
  const admin = new TestClient();
  const staff = new TestClient();
  const member = new TestClient();

  beforeAll(async () => {
    await admin.login(SEED.admin.email, SEED.admin.password);
    await staff.login(SEED.staff.email, SEED.staff.password);
    await member.login(SEED.members.active20d.email, SEED.members.active20d.password);
  });

  describe("Announcements", () => {
    it("admin can access announcements page", async () => {
      const { status } = await admin.getPage("/admin/announcements");
      expect(status).toBe(200);
    });

    it("staff can access announcements page", async () => {
      const { status } = await staff.getPage("/admin/announcements");
      expect(status).toBe(200);
    });

    it("member cannot access announcements admin page", async () => {
      const { status } = await member.getPage("/admin/announcements");
      expect([302, 307]).toContain(status);
    });
  });

  describe("Member Measurements (Portal)", () => {
    it("member can access measurements page", async () => {
      const { status } = await member.getPage("/member/measurements");
      expect(status).toBe(200);
    });
  });

  describe("Member Classes (Portal)", () => {
    it("member can access classes page", async () => {
      const { status } = await member.getPage("/member/classes");
      expect(status).toBe(200);
    });
  });

  describe("Member Invoices (Portal)", () => {
    it("member can access invoices page", async () => {
      const { status } = await member.getPage("/member/invoices");
      expect(status).toBe(200);
    });
  });

  describe("Member Profile (Portal)", () => {
    it("member can access profile page", async () => {
      const { status } = await member.getPage("/member/profile");
      expect(status).toBe(200);
    });
  });

  describe("Member Stats (Portal)", () => {
    it("member can access stats page", async () => {
      const { status } = await member.getPage("/member/stats");
      expect(status).toBe(200);
    });
  });
});
