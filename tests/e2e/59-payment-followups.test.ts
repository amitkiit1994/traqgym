/**
 * E2E: Payment Followups & Balance Due
 *
 * Tests payment followup and balance-due page access and content.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { TestClient, AnonClient, SEED } from "./helpers";

describe("Payment Followups", () => {
  const admin = new TestClient();
  const staff = new TestClient();
  const member = new TestClient();
  const anon = new AnonClient();

  beforeAll(async () => {
    await admin.login(SEED.admin.email, SEED.admin.password);
    await staff.login(SEED.staff.email, SEED.staff.password);
    await member.login(SEED.members.active20d.email, SEED.members.active20d.password);
  });

  describe("Followups Page", () => {
    it("admin can access followups page", async () => {
      const { status } = await admin.getPage("/admin/followups");
      expect(status).toBe(200);
    });

    it("followups page contains followup-related content", async () => {
      const { status, html } = await admin.getPage("/admin/followups");
      expect(status).toBe(200);
      expect(html.toLowerCase()).toMatch(/follow.?up|payment|due|reminder/);
    });

    it("staff can access followups page", async () => {
      const { status } = await staff.getPage("/admin/followups");
      expect(status).toBe(200);
    });

    it("member cannot access followups page", async () => {
      const { status } = await member.getPage("/admin/followups");
      expect([302, 307]).toContain(status);
    });

    it("unauthenticated user is redirected from followups page", async () => {
      const { status } = await anon.get("/admin/followups");
      expect([302, 307]).toContain(status);
    });
  });

  describe("Balance Due Page", () => {
    it("admin can access balance-due page", async () => {
      const { status } = await admin.getPage("/admin/balance-due");
      expect(status).toBe(200);
    });

    it("balance-due page contains balance-related content", async () => {
      const { status, html } = await admin.getPage("/admin/balance-due");
      expect(status).toBe(200);
      expect(html.toLowerCase()).toMatch(/balance|due|partial|payment/);
    });

    it("staff can access balance-due page", async () => {
      const { status } = await staff.getPage("/admin/balance-due");
      expect(status).toBe(200);
    });

    it("member cannot access balance-due page", async () => {
      const { status } = await member.getPage("/admin/balance-due");
      expect([302, 307]).toContain(status);
    });
  });
});
