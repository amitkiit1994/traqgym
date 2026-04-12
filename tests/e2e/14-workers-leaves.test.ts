/**
 * E2E: Workers CRUD, Leaves, Staff Performance
 */
import { describe, it, expect, beforeAll } from "vitest";
import { TestClient, AnonClient, SEED } from "./helpers";

describe("Workers & Leaves", () => {
  const admin = new TestClient();
  const staff = new TestClient();
  const member = new TestClient();

  beforeAll(async () => {
    await admin.login(SEED.admin.email, SEED.admin.password);
    await staff.login(SEED.staff.email, SEED.staff.password);
    await member.login(SEED.members.active20d.email, SEED.members.active20d.password);
  });

  describe("Workers Page", () => {
    it("admin can access workers page", async () => {
      const { status } = await admin.getPage("/admin/workers");
      expect(status).toBe(200);
    });

    it("member cannot access workers page", async () => {
      const { status } = await member.getPage("/admin/workers");
      expect([302, 307]).toContain(status);
    });
  });

  describe("Leaves Page", () => {
    it("admin can access leaves page", async () => {
      const { status } = await admin.getPage("/admin/leaves");
      expect(status).toBe(200);
    });

    it("staff can access leaves page", async () => {
      const { status } = await staff.getPage("/admin/leaves");
      expect(status).toBe(200);
    });

    it("member cannot access leaves page", async () => {
      const { status } = await member.getPage("/admin/leaves");
      expect([302, 307]).toContain(status);
    });
  });

  describe("Staff Performance", () => {
    it("admin can access staff performance page", async () => {
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
