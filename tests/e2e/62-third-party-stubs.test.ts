/**
 * E2E: Third Party Integration Pages
 *
 * Verifies that pages related to external integrations (Razorpay,
 * SMS/notifications, biometric devices, bulk notify) are accessible
 * to admin users.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { TestClient, AnonClient, SEED } from "./helpers";

describe("Third Party Integration Pages", () => {
  const admin = new TestClient();
  const member = new TestClient();
  const anon = new AnonClient();

  beforeAll(async () => {
    await admin.login(SEED.admin.email, SEED.admin.password);
    await member.login(SEED.members.active20d.email, SEED.members.active20d.password);
  });

  describe("Settings Page (Razorpay config)", () => {
    it("admin can access settings page", async () => {
      const { status } = await admin.getPage("/admin/settings");
      expect(status).toBe(200);
    });

    it("settings page contains configuration content", async () => {
      const { html } = await admin.getPage("/admin/settings");
      expect(html.toLowerCase()).toMatch(/settings|configuration|razorpay|payment/);
    });

    it("member cannot access settings page", async () => {
      const { status } = await member.getPage("/admin/settings");
      expect([302, 307]).toContain(status);
    });
  });

  describe("Notifications Page (SMS/notification settings)", () => {
    it("admin can access notifications page", async () => {
      const { status } = await admin.getPage("/admin/notifications");
      expect(status).toBe(200);
    });

    it("notifications page contains notification content", async () => {
      const { html } = await admin.getPage("/admin/notifications");
      expect(html.toLowerCase()).toMatch(/notification|sms|whatsapp|message|template/);
    });

    it("member cannot access notifications page", async () => {
      const { status } = await member.getPage("/admin/notifications");
      expect([302, 307]).toContain(status);
    });
  });

  describe("Biometric Device Page", () => {
    it("admin can access biometric page", async () => {
      const { status } = await admin.getPage("/admin/biometric");
      expect(status).toBe(200);
    });

    it("biometric page contains device-related content", async () => {
      const { html } = await admin.getPage("/admin/biometric");
      expect(html.toLowerCase()).toMatch(/biometric|device|fingerprint|mapping/);
    });

    it("member cannot access biometric page", async () => {
      const { status } = await member.getPage("/admin/biometric");
      expect([302, 307]).toContain(status);
    });
  });

  describe("Bulk Notify Page", () => {
    it("admin can access bulk-notify page", async () => {
      const { status } = await admin.getPage("/admin/bulk-notify");
      expect(status).toBe(200);
    });

    it("bulk-notify page contains notification content", async () => {
      const { html } = await admin.getPage("/admin/bulk-notify");
      expect(html.toLowerCase()).toMatch(/bulk|notify|message|send|sms|whatsapp/);
    });

    it("member cannot access bulk-notify page", async () => {
      const { status } = await member.getPage("/admin/bulk-notify");
      expect([302, 307]).toContain(status);
    });

    it("unauthenticated user is redirected from bulk-notify", async () => {
      const { status } = await anon.get("/admin/bulk-notify");
      expect([302, 307]).toContain(status);
    });
  });

  describe("In-App Notifications Page", () => {
    it("admin can access in-app-notifications page", async () => {
      const { status } = await admin.getPage("/admin/in-app-notifications");
      expect(status).toBe(200);
    });

    it("member cannot access in-app-notifications page", async () => {
      const { status } = await member.getPage("/admin/in-app-notifications");
      expect([302, 307]).toContain(status);
    });
  });
});
