/**
 * E2E: Attendance — Member & Worker check-in/check-out flows
 */
import { describe, it, expect, beforeAll } from "vitest";
import { TestClient, AnonClient, SEED } from "./helpers";

describe("Attendance Flows", () => {
  const admin = new TestClient();
  const staff = new TestClient();
  const member = new TestClient();
  const anon = new AnonClient();

  beforeAll(async () => {
    await admin.login(SEED.admin.email, SEED.admin.password);
    await staff.login(SEED.staff.email, SEED.staff.password);
    await member.login(SEED.members.active20d.email, SEED.members.active20d.password);
  });

  describe("Admin Attendance Page", () => {
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

  describe("Kiosk Check-in", () => {
    it("active member can check in via kiosk", async () => {
      const { status, body } = await anon.post("/api/kiosk/checkin", {
        phone: SEED.members.activeAnnual.phone,
        locationId: SEED.locations.cc.id,
      });
      // First check-in or duplicate (both OK)
      expect([200, 429]).toContain(status);
      if (status === 200) {
        expect(body.memberName).toBeTruthy();
      }
    });

    it("member with no plan is rejected", async () => {
      const { status, body } = await anon.post("/api/kiosk/checkin", {
        phone: SEED.members.noTicket.phone,
        locationId: SEED.locations.main.id,
      });
      expect([403, 429]).toContain(status);
      if (status === 403) {
        expect(body.error).toBeTruthy();
      }
    });

    it("unknown phone is rejected", async () => {
      const { status, body } = await anon.post("/api/kiosk/checkin", {
        phone: "0000000000",
        locationId: SEED.locations.main.id,
      });
      expect([404, 429]).toContain(status);
    });

    it("missing phone returns 400", async () => {
      const { status } = await anon.post("/api/kiosk/checkin", {
        locationId: SEED.locations.main.id,
      });
      expect(status).toBe(400);
    });

    it("missing locationId returns 400", async () => {
      const { status } = await anon.post("/api/kiosk/checkin", {
        phone: SEED.members.active20d.phone,
      });
      expect(status).toBe(400);
    });
  });
});
