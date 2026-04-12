/**
 * E2E: Member Portal
 *
 * Tests member-facing pages, profile, stats, invoices,
 * measurements, and self-service flows.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { TestClient, AnonClient, SEED } from "./helpers";

describe("Member Portal", () => {
  const admin = new TestClient();
  const member = new TestClient();
  const member2 = new TestClient();
  const anon = new AnonClient();

  beforeAll(async () => {
    await admin.login(SEED.admin.email, SEED.admin.password);
    await member.login(SEED.members.active20d.email, SEED.members.active20d.password);
    await member2.login(SEED.members.activeAnnual.email, SEED.members.activeAnnual.password);
  });

  // ---- Member pages ----

  describe("Member Pages", () => {
    const pages = [
      "/member",
      "/member/stats",
      "/member/profile",
      "/member/invoices",
      "/member/measurements",
      "/member/classes",
    ];

    for (const page of pages) {
      it(`member can access ${page}`, async () => {
        const { status } = await member.getPage(page);
        expect(status).toBe(200);
      });
    }

    for (const page of pages) {
      it(`anon is redirected from ${page}`, async () => {
        const { status } = await anon.get(page);
        expect([302, 307]).toContain(status);
      });
    }
  });

  // ---- Member session ----

  describe("Member Session", () => {
    it("member session has correct fields", async () => {
      const { body } = await member.get("/api/auth/session");
      expect(body.user.email).toBe(SEED.members.active20d.email);
      expect(body.user.actorType).toBe("member");
      expect(body.user.role).toBe("member");
    });

    it("second member has different session", async () => {
      const { body } = await member2.get("/api/auth/session");
      expect(body.user.email).toBe(SEED.members.activeAnnual.email);
      expect(body.user.id).not.toBe(SEED.members.active20d.id);
    });
  });

  // ---- Member cannot access admin ----

  describe("Member Admin Blocking", () => {
    const adminPages = [
      "/admin/dashboard",
      "/admin/members",
      "/admin/plans",
      "/admin/renewals",
      "/admin/settings",
      "/admin/workers",
      "/admin/expenses",
    ];

    for (const page of adminPages) {
      it(`member cannot access ${page}`, async () => {
        const { status } = await member.getPage(page);
        expect([302, 307]).toContain(status);
      });
    }
  });

  // ---- Member API access control ----

  describe("Member API Restrictions", () => {
    it("member cannot access settings API", async () => {
      const { status } = await member.get("/api/admin/settings");
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

    it("member cannot list people", async () => {
      const { status } = await member.get("/api/people");
      expect([401, 302]).toContain(status);
    });

    it("member cannot access biometric devices", async () => {
      const { status } = await member.get("/api/biometric/devices");
      expect([401, 302]).toContain(status);
    });
  });

  // ---- Public pages still accessible ----

  describe("Public Pages", () => {
    it("login page loads", async () => {
      const { status } = await anon.get("/login");
      expect(status).toBe(200);
    });

    it("kiosk page loads", async () => {
      const { status } = await anon.get("/kiosk");
      expect(status).toBe(200);
    });
  });
});
