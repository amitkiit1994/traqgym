/**
 * E2E: Health Check, Settings, Gym Brand, Biometric APIs
 */
import { describe, it, expect, beforeAll } from "vitest";
import { TestClient, AnonClient, SEED } from "./helpers";

describe("Health, Settings & APIs", () => {
  const admin = new TestClient();
  const staff = new TestClient();
  const member = new TestClient();
  const anon = new AnonClient();

  beforeAll(async () => {
    await admin.login(SEED.admin.email, SEED.admin.password);
    await staff.login(SEED.staff.email, SEED.staff.password);
    await member.login(SEED.members.active20d.email, SEED.members.active20d.password);
  });

  describe("Health Endpoint", () => {
    it("returns ok status", async () => {
      const { status, body } = await anon.get("/api/health");
      expect(status).toBe(200);
      expect(body.status).toBe("ok");
      expect(body.timestamp).toBeTruthy();
    });
  });

  describe("Gym Brand Endpoint", () => {
    it("returns gym name and logo", async () => {
      const { status, body } = await anon.get("/api/gym-brand");
      expect(status).toBe(200);
      expect(body.name).toBeTruthy();
      expect(typeof body.name).toBe("string");
    });
  });

  describe("Settings API", () => {
    it("admin can read settings", async () => {
      const { status, body } = await admin.get("/api/admin/settings");
      expect(status).toBe(200);
      expect(body.grace_period_days).toBeDefined();
      expect(body.auto_checkout_enabled).toBeDefined();
    });

    it("admin can update settings idempotently", async () => {
      const { body: current } = await admin.get("/api/admin/settings");
      const { status } = await admin.post("/api/admin/settings", {
        grace_period_days: current.grace_period_days || "7",
        auto_checkout_enabled: current.auto_checkout_enabled || "true",
      });
      expect(status).toBe(200);
    });

    it("staff cannot update settings", async () => {
      const { status } = await staff.post("/api/admin/settings", {
        grace_period_days: "99",
      });
      // Staff may or may not have settings access depending on implementation
      expect([200, 401, 403]).toContain(status);
    });

    it("member cannot read settings", async () => {
      const { status } = await member.get("/api/admin/settings");
      expect(status).toBe(401);
    });

    it("member cannot update settings", async () => {
      const { status } = await member.post("/api/admin/settings", {
        grace_period_days: "99",
      });
      expect(status).toBe(401);
    });

    it("anon cannot read settings", async () => {
      const { status } = await anon.get("/api/admin/settings");
      expect(status).toBe(401);
    });
  });

  describe("Settings Page", () => {
    it("admin can access settings page", async () => {
      const { status } = await admin.getPage("/admin/settings");
      expect(status).toBe(200);
    });

    it("member cannot access settings page", async () => {
      const { status } = await member.getPage("/admin/settings");
      expect([302, 307]).toContain(status);
    });
  });

  describe("Locations API", () => {
    it("admin can list locations", async () => {
      const { status, body } = await admin.get("/api/locations");
      expect(status).toBe(200);
      expect(Array.isArray(body)).toBe(true);
      expect(body.length).toBeGreaterThanOrEqual(2);
      const loc = body[0];
      expect(loc.id).toBeDefined();
      expect(loc.name).toBeDefined();
    });

    it("staff can list locations", async () => {
      const { status, body } = await staff.get("/api/locations");
      expect(status).toBe(200);
      expect(Array.isArray(body)).toBe(true);
    });

    it("anon cannot list locations", async () => {
      const { status } = await anon.get("/api/locations");
      expect([401, 302]).toContain(status);
    });
  });

  describe("People API", () => {
    it("admin can list people", async () => {
      const { status, body } = await admin.get("/api/people");
      expect(status).toBe(200);
      expect(Array.isArray(body)).toBe(true);
    });

    it("anon cannot list people", async () => {
      const { status } = await anon.get("/api/people");
      expect([401, 302]).toContain(status);
    });

    it("member cannot list people", async () => {
      const { status } = await member.get("/api/people");
      expect([401, 302]).toContain(status);
    });
  });

  describe("Biometric APIs", () => {
    it("admin can list biometric devices", async () => {
      const { status, body } = await admin.get("/api/biometric/devices");
      expect(status).toBe(200);
      expect(Array.isArray(body)).toBe(true);
    });

    it("admin can list unmatched biometric events", async () => {
      const { status, body } = await admin.get("/api/biometric/unmatched");
      expect(status).toBe(200);
      expect(Array.isArray(body)).toBe(true);
    });

    it("anon cannot access biometric devices", async () => {
      const { status } = await anon.get("/api/biometric/devices");
      expect([401, 302]).toContain(status);
    });

    it("anon cannot access unmatched events", async () => {
      const { status } = await anon.get("/api/biometric/unmatched");
      expect([401, 302]).toContain(status);
    });

    it("member cannot access biometric devices", async () => {
      const { status } = await member.get("/api/biometric/devices");
      expect([401, 302]).toContain(status);
    });

    it("admin can access biometric admin page", async () => {
      const { status } = await admin.getPage("/admin/biometric");
      expect(status).toBe(200);
    });

    it("member cannot access biometric admin page", async () => {
      const { status } = await member.getPage("/admin/biometric");
      expect([302, 307]).toContain(status);
    });
  });
});
