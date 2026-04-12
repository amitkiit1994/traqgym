/**
 * E2E: Invoices
 *
 * Tests invoice page access. Invoices are available at /member/invoices
 * for members. There is no dedicated /admin/invoices page — admin views
 * invoices through the renewals page.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { TestClient, AnonClient, SEED } from "./helpers";

describe("Invoices", () => {
  const admin = new TestClient();
  const member = new TestClient();
  const anon = new AnonClient();

  beforeAll(async () => {
    await admin.login(SEED.admin.email, SEED.admin.password);
    await member.login(SEED.members.active20d.email, SEED.members.active20d.password);
  });

  describe("Member Invoice Access", () => {
    it("member can access invoices page", async () => {
      const { status } = await member.getPage("/member/invoices");
      expect(status).toBe(200);
    });

    it("invoices page contains invoice-related content", async () => {
      const { status, html } = await member.getPage("/member/invoices");
      expect(status).toBe(200);
      expect(html.toLowerCase()).toMatch(/invoice|payment|receipt|billing/);
    });

    it("unauthenticated user is redirected from member invoices", async () => {
      const { status } = await anon.get("/member/invoices");
      expect([302, 307]).toContain(status);
    });
  });

  describe("Admin Invoice-Related Access", () => {
    it("admin can access renewals page (includes invoice data)", async () => {
      const { status } = await admin.getPage("/admin/renewals");
      expect(status).toBe(200);
    });

    it("member cannot access admin renewals page", async () => {
      const { status } = await member.getPage("/admin/renewals");
      expect([302, 307]).toContain(status);
    });
  });
});
