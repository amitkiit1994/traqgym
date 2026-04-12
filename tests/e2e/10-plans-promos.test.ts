/**
 * E2E: Plans & Promo Codes
 */
import { describe, it, expect, beforeAll } from "vitest";
import { TestClient, AnonClient, SEED } from "./helpers";

describe("Plans & Promo Codes", () => {
  const admin = new TestClient();
  const staff = new TestClient();
  const member = new TestClient();

  beforeAll(async () => {
    await admin.login(SEED.admin.email, SEED.admin.password);
    await staff.login(SEED.staff.email, SEED.staff.password);
    await member.login(SEED.members.active20d.email, SEED.members.active20d.password);
  });

  describe("Plans Page", () => {
    it("admin can access plans page", async () => {
      const { status } = await admin.getPage("/admin/plans");
      expect(status).toBe(200);
    });

    it("staff can access plans page", async () => {
      const { status } = await staff.getPage("/admin/plans");
      expect(status).toBe(200);
    });

    it("member cannot access plans admin page", async () => {
      const { status } = await member.getPage("/admin/plans");
      expect([302, 307]).toContain(status);
    });
  });

  describe("Promo Codes Page", () => {
    it("admin can access promos page", async () => {
      const { status } = await admin.getPage("/admin/promos");
      expect(status).toBe(200);
    });

    it("staff can access promos page", async () => {
      const { status } = await staff.getPage("/admin/promos");
      expect(status).toBe(200);
    });

    it("member cannot access promos page", async () => {
      const { status } = await member.getPage("/admin/promos");
      expect([302, 307]).toContain(status);
    });
  });
});
