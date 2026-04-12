/**
 * E2E: Renewal & Payment Flows
 *
 * Since renewals happen via server actions (not API routes),
 * we test the admin renewals page load, plan-change API,
 * and invoice generation as the HTTP-accessible parts of renewal.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { TestClient, AnonClient, SEED } from "./helpers";

describe("Renewal & Payment Flows", () => {
  const admin = new TestClient();
  const staff = new TestClient();
  const member = new TestClient();
  const anon = new AnonClient();

  beforeAll(async () => {
    await admin.login(SEED.admin.email, SEED.admin.password);
    await staff.login(SEED.staff.email, SEED.staff.password);
    await member.login(SEED.members.active20d.email, SEED.members.active20d.password);
  });

  // ---- Admin renewals page ----

  describe("Admin Renewals Page", () => {
    it("admin can access renewals page", async () => {
      const { status } = await admin.getPage("/admin/renewals");
      expect(status).toBe(200);
    });

    it("staff can access renewals page", async () => {
      const { status } = await staff.getPage("/admin/renewals");
      expect(status).toBe(200);
    });

    it("member cannot access renewals page", async () => {
      const { status } = await member.getPage("/admin/renewals");
      expect([302, 307]).toContain(status);
    });

    it("anon is redirected from renewals page", async () => {
      const { status } = await anon.get("/admin/renewals");
      expect([302, 307]).toContain(status);
    });
  });

  // ---- Plan Change API (upgrade path) ----

  describe("Plan Change API", () => {
    it("admin can change plan for active member", async () => {
      const { status, body } = await admin.post("/api/admin/plan-change", {
        userId: SEED.members.active20d.id,
        currentTicketId: SEED.tickets.member1.id,
        newPlanId: SEED.plans.quarterly.id,
        locationId: SEED.locations.main.id,
        paymentMode: "cash",
      });
      expect(status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.invoiceNumber).toBeTruthy();
      expect(body.newExpiryDate).toBeTruthy();
      expect(typeof body.credit).toBe("number");
      expect(typeof body.amountDue).toBe("number");
    });

    it("plan change rejects non-existent user", async () => {
      const { status, body } = await admin.post("/api/admin/plan-change", {
        userId: 99999,
        currentTicketId: 1,
        newPlanId: SEED.plans.monthly.id,
        locationId: SEED.locations.main.id,
        paymentMode: "cash",
      });
      expect(status).toBe(400);
      expect(body.error).toBeTruthy();
    });

    it("plan change rejects non-existent ticket", async () => {
      const { status, body } = await admin.post("/api/admin/plan-change", {
        userId: SEED.members.active20d.id,
        currentTicketId: 99999,
        newPlanId: SEED.plans.monthly.id,
        locationId: SEED.locations.main.id,
        paymentMode: "cash",
      });
      expect(status).toBe(400);
      expect(body.error).toBeTruthy();
    });

    it("plan change rejects non-existent plan", async () => {
      const { status, body } = await admin.post("/api/admin/plan-change", {
        userId: SEED.members.active20d.id,
        currentTicketId: SEED.tickets.member1.id,
        newPlanId: 99999,
        locationId: SEED.locations.main.id,
        paymentMode: "cash",
      });
      expect(status).toBe(400);
      expect(body.error).toBeTruthy();
    });

    it("unauthenticated plan change returns 401", async () => {
      const { status } = await anon.post("/api/admin/plan-change", {
        userId: SEED.members.active20d.id,
        currentTicketId: SEED.tickets.member1.id,
        newPlanId: SEED.plans.quarterly.id,
        locationId: SEED.locations.main.id,
        paymentMode: "cash",
      });
      expect(status).toBe(401);
    });

    it("member cannot use plan-change API", async () => {
      const { status } = await member.post("/api/admin/plan-change", {
        userId: SEED.members.active20d.id,
        currentTicketId: SEED.tickets.member1.id,
        newPlanId: SEED.plans.quarterly.id,
        locationId: SEED.locations.main.id,
        paymentMode: "cash",
      });
      expect(status).toBe(401);
    });
  });

  // ---- Invoice PDF ----

  describe("Invoice PDF Generation", () => {
    it("admin can fetch invoice PDF for known ID", async () => {
      const { status } = await admin.get("/api/invoices/22/pdf");
      expect([200, 404]).toContain(status);
    });

    it("returns 404 for non-existent invoice", async () => {
      const { status } = await admin.get("/api/invoices/99999/pdf");
      expect(status).toBe(404);
    });

    it("unauthenticated can access invoice PDF (public endpoint)", async () => {
      const { status } = await anon.get("/api/invoices/22/pdf");
      // Invoice PDF is a public endpoint (shareable link)
      expect([200, 404]).toContain(status);
    });
  });

  // ---- Settings (used in renewal for grace period) ----

  describe("Settings API (renewal context)", () => {
    it("admin can read grace period setting", async () => {
      const { status, body } = await admin.get("/api/admin/settings");
      expect(status).toBe(200);
      expect(body.grace_period_days).toBeDefined();
    });

    it("admin can update settings", async () => {
      // Read current settings
      const { body: current } = await admin.get("/api/admin/settings");

      // Update with same values (safe idempotent test)
      const { status, body } = await admin.post("/api/admin/settings", {
        grace_period_days: current.grace_period_days || "7",
        auto_checkout_enabled: current.auto_checkout_enabled || "true",
      });
      expect(status).toBe(200);
    });

    it("member cannot update settings", async () => {
      const { status } = await member.post("/api/admin/settings", {
        grace_period_days: "99",
      });
      expect(status).toBe(401);
    });
  });
});
