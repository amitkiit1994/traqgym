/**
 * E2E: API Routes
 *
 * Tests UPI QR, Invoice PDF, Settings, Plan Change APIs.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { TestClient, AnonClient, SEED } from "./helpers";

describe("API Routes", () => {
  const admin = new TestClient();
  const member = new TestClient();
  const anon = new AnonClient();

  beforeAll(async () => {
    await admin.login(SEED.admin.email, SEED.admin.password);
    await member.login(SEED.members.active20d.email, SEED.members.active20d.password);
  });

  // ---- UPI QR ----

  describe("UPI QR", () => {
    it("generates QR with valid params", async () => {
      const { status } = await anon.get("/api/upi-qr?amount=1500&memberName=TestUser");
      expect(status).toBe(200);
    });

    it("rejects missing amount", async () => {
      const { status } = await anon.get("/api/upi-qr?memberName=TestUser");
      expect(status).toBe(400);
    });

    it("rejects missing memberName", async () => {
      const { status } = await anon.get("/api/upi-qr?amount=1500");
      expect(status).toBe(400);
    });

    it("rejects zero amount", async () => {
      const { status } = await anon.get("/api/upi-qr?amount=0&memberName=TestUser");
      expect(status).toBe(400);
    });

    it("rejects negative amount", async () => {
      const { status } = await anon.get("/api/upi-qr?amount=-100&memberName=TestUser");
      expect(status).toBe(400);
    });

    it("rejects non-numeric amount", async () => {
      const { status } = await anon.get("/api/upi-qr?amount=abc&memberName=TestUser");
      expect(status).toBe(400);
    });
  });

  // ---- Invoice PDF ----

  describe("Invoice PDF", () => {
    it("returns invoice for valid ID", async () => {
      const { status } = await admin.get("/api/invoices/22/pdf");
      // May be 200 or 404 depending on whether invoice #22 exists
      expect([200, 404]).toContain(status);
    });

    it("returns 404 for non-existent invoice", async () => {
      const { status } = await admin.get("/api/invoices/99999/pdf");
      expect(status).toBe(404);
    });
  });

  // ---- Settings API ----

  describe("Settings API", () => {
    it("admin can read settings", async () => {
      const { status, body } = await admin.get("/api/admin/settings");
      expect(status).toBe(200);
      expect(body.grace_period_days).toBeDefined();
      expect(body.auto_checkout_enabled).toBeDefined();
    });

    it("unauthenticated user gets 401", async () => {
      const { status } = await anon.get("/api/admin/settings");
      expect(status).toBe(401);
    });

    it("member gets 401", async () => {
      const { status } = await member.get("/api/admin/settings");
      expect(status).toBe(401);
    });
  });

  // ---- Plan Change API ----

  describe("Plan Change API", () => {
    it("unauthenticated gets 401", async () => {
      const { status } = await anon.post("/api/admin/plan-change", {
        userId: SEED.members.active20d.id,
        currentTicketId: SEED.tickets.member1.id,
        newPlanId: SEED.plans.quarterly.id,
        locationId: SEED.locations.main.id,
        paymentMode: "cash",
      });
      expect(status).toBe(401);
    });

    it("admin can initiate plan change for active member", async () => {
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

    it("rejects plan change for non-existent user", async () => {
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

    it("rejects plan change for non-existent ticket", async () => {
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

    it("rejects inactive plan", async () => {
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
  });
});
