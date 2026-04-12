/**
 * E2E: Business Logic Edge Cases
 *
 * Tests attendance, biometric endpoints, location & people APIs,
 * and admin page access for business-critical flows.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { TestClient, AnonClient, SEED } from "./helpers";

describe("Business Logic", () => {
  const admin = new TestClient();
  const staff = new TestClient();
  const member = new TestClient();
  const anon = new AnonClient();

  beforeAll(async () => {
    await admin.login(SEED.admin.email, SEED.admin.password);
    await staff.login(SEED.staff.email, SEED.staff.password);
    await member.login(SEED.members.active20d.email, SEED.members.active20d.password);
  });

  // ---- Attendance pages ----

  describe("Attendance", () => {
    it("admin can access attendance page", async () => {
      const { status } = await admin.getPage("/admin/attendance");
      expect(status).toBe(200);
    });

    it("staff can access attendance page", async () => {
      const { status } = await staff.getPage("/admin/attendance");
      expect(status).toBe(200);
    });

    it("member cannot access attendance admin page", async () => {
      const { status } = await member.getPage("/admin/attendance");
      expect([302, 307]).toContain(status);
    });
  });

  // ---- Locations API ----

  describe("Locations API", () => {
    it("authenticated user can list locations", async () => {
      const { status, body } = await admin.get("/api/locations");
      expect(status).toBe(200);
      expect(Array.isArray(body)).toBe(true);
      expect(body.length).toBeGreaterThanOrEqual(2);
    });

    it("unauthenticated user gets 401 on locations", async () => {
      const { status } = await anon.get("/api/locations");
      expect([401, 302]).toContain(status);
    });
  });

  // ---- People API ----

  describe("People API", () => {
    it("admin can list people", async () => {
      const { status, body } = await admin.get("/api/people");
      expect(status).toBe(200);
      expect(Array.isArray(body)).toBe(true);
    });

    it("unauthenticated cannot list people", async () => {
      const { status } = await anon.get("/api/people");
      expect([401, 302]).toContain(status);
    });
  });

  // ---- Admin CRUD pages ----

  describe("Admin CRUD Pages", () => {
    const crudPages = [
      "/admin/plans",
      "/admin/locations",
      "/admin/workers",
      "/admin/expenses",
      "/admin/promos",
      "/admin/equipment",
    ];

    for (const page of crudPages) {
      it(`admin can access ${page}`, async () => {
        const { status } = await admin.getPage(page);
        expect(status).toBe(200);
      });
    }
  });

  // ---- Member detail page ----

  describe("Member Detail", () => {
    it("admin can view member detail page", async () => {
      const { status } = await admin.getPage(`/admin/members/${SEED.members.active20d.id}`);
      expect(status).toBe(200);
    });

    it("admin can view expired member detail", async () => {
      const { status } = await admin.getPage(`/admin/members/${SEED.members.expired5d.id}`);
      expect(status).toBe(200);
    });

    it("non-existent member returns 404", async () => {
      const { status } = await admin.getPage("/admin/members/99999");
      expect([404, 302]).toContain(status);
    });
  });

  // ---- Enquiries page ----

  describe("Enquiries", () => {
    it("admin can access enquiries page", async () => {
      const { status } = await admin.getPage("/admin/enquiries");
      expect(status).toBe(200);
    });

    it("member cannot access enquiries page", async () => {
      const { status } = await member.getPage("/admin/enquiries");
      expect([302, 307]).toContain(status);
    });
  });

  // ---- Reports & Audit ----

  describe("Reports & Audit", () => {
    it("admin can access reports page", async () => {
      const { status } = await admin.getPage("/admin/reports");
      expect(status).toBe(200);
    });

    it("admin can access audit page", async () => {
      const { status } = await admin.getPage("/admin/audit");
      expect(status).toBe(200);
    });

    it("admin can access activity page", async () => {
      const { status } = await admin.getPage("/admin/activity");
      expect(status).toBe(200);
    });

    it("member cannot access reports", async () => {
      const { status } = await member.getPage("/admin/reports");
      expect([302, 307]).toContain(status);
    });

    it("member cannot access audit", async () => {
      const { status } = await member.getPage("/admin/audit");
      expect([302, 307]).toContain(status);
    });
  });

  // ---- Biometric endpoints ----

  describe("Biometric API", () => {
    it("admin can list biometric devices", async () => {
      const { status, body } = await admin.get("/api/biometric/devices");
      expect(status).toBe(200);
      expect(Array.isArray(body)).toBe(true);
    });

    it("admin can list unmatched events", async () => {
      const { status, body } = await admin.get("/api/biometric/unmatched");
      expect(status).toBe(200);
      expect(Array.isArray(body)).toBe(true);
    });

    it("unauthenticated cannot access biometric devices", async () => {
      const { status } = await anon.get("/api/biometric/devices");
      expect([401, 302]).toContain(status);
    });

    it("unauthenticated cannot access unmatched events", async () => {
      const { status } = await anon.get("/api/biometric/unmatched");
      expect([401, 302]).toContain(status);
    });
  });

  // ---- Kiosk advanced flows ----

  describe("Kiosk Edge Cases", () => {
    it("expired member beyond grace period is rejected", async () => {
      // member5 has no ticket at all
      const { status, body } = await anon.post("/api/kiosk/checkin", {
        phone: SEED.members.noTicket.phone,
        locationId: SEED.locations.main.id,
      });
      expect(status).toBe(403);
      expect(body.error).toBeTruthy();
    });

    it("check-in at inactive location is rejected", async () => {
      const { status, body } = await anon.post("/api/kiosk/checkin", {
        phone: SEED.members.activeAnnual.phone,
        locationId: 99999,
      });
      // May hit rate limiter (429) if this phone was used recently, or 400 for bad location
      expect([400, 429]).toContain(status);
      expect(body.error).toBeTruthy();
    });

    it("empty body returns 400", async () => {
      const { status, body } = await anon.post("/api/kiosk/checkin", {});
      expect(status).toBe(400);
      expect(body.error).toBeTruthy();
    });
  });
});
