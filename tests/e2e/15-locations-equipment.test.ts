/**
 * E2E: Locations, Equipment, Opening Hours
 */
import { describe, it, expect, beforeAll } from "vitest";
import { TestClient, AnonClient, SEED } from "./helpers";

describe("Locations & Equipment", () => {
  const admin = new TestClient();
  const staff = new TestClient();
  const member = new TestClient();
  const anon = new AnonClient();

  beforeAll(async () => {
    await admin.login(SEED.admin.email, SEED.admin.password);
    await staff.login(SEED.staff.email, SEED.staff.password);
    await member.login(SEED.members.active20d.email, SEED.members.active20d.password);
  });

  describe("Locations", () => {
    it("admin can access locations page", async () => {
      const { status } = await admin.getPage("/admin/locations");
      expect(status).toBe(200);
    });

    it("authenticated user can list locations via API", async () => {
      const { status, body } = await admin.get("/api/locations");
      expect(status).toBe(200);
      expect(Array.isArray(body)).toBe(true);
      expect(body.length).toBeGreaterThanOrEqual(2);
      // Verify structure
      const loc = body[0];
      expect(loc.id).toBeDefined();
      expect(loc.name).toBeDefined();
    });

    it("staff can list locations via API", async () => {
      const { status, body } = await staff.get("/api/locations");
      expect(status).toBe(200);
      expect(Array.isArray(body)).toBe(true);
    });

    it("unauthenticated cannot list locations", async () => {
      const { status } = await anon.get("/api/locations");
      expect([401, 302]).toContain(status);
    });

    it("member cannot access locations admin page", async () => {
      const { status } = await member.getPage("/admin/locations");
      expect([302, 307]).toContain(status);
    });
  });

  describe("Equipment", () => {
    it("admin can access equipment page", async () => {
      const { status } = await admin.getPage("/admin/equipment");
      expect(status).toBe(200);
    });

    it("staff can access equipment page", async () => {
      const { status } = await staff.getPage("/admin/equipment");
      expect(status).toBe(200);
    });

    it("member cannot access equipment page", async () => {
      const { status } = await member.getPage("/admin/equipment");
      expect([302, 307]).toContain(status);
    });
  });
});
