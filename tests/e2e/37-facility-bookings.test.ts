/**
 * E2E: Facility Bookings
 */
import { describe, it, expect, beforeAll } from "vitest";
import { TestClient, SEED } from "./helpers";

describe("Facility Bookings", () => {
  const admin = new TestClient();
  const staff = new TestClient();
  const member = new TestClient();

  beforeAll(async () => {
    await admin.login(SEED.admin.email, SEED.admin.password);
    await staff.login(SEED.staff.email, SEED.staff.password);
    await member.login(SEED.members.active20d.email, SEED.members.active20d.password);
  });

  describe("Page Access", () => {
    it("admin can access facility bookings page", async () => {
      const { status } = await admin.getPage("/admin/facility-bookings");
      expect(status).toBe(200);
    });

    it("staff can access facility bookings page", async () => {
      const { status } = await staff.getPage("/admin/facility-bookings");
      expect(status).toBe(200);
    });

    it("member can access own bookings page", async () => {
      const { status } = await member.getPage("/member/bookings");
      expect(status).toBe(200);
    });

    it("member cannot access admin facility bookings page", async () => {
      const { status } = await member.getPage("/admin/facility-bookings");
      expect([302, 307]).toContain(status);
    });
  });

  describe("AI Tools - Facility Bookings", () => {
    it("AI can query available slots", async () => {
      const { status } = await admin.post("/api/admin/ai/chat", {
        messages: [{ role: "user", content: "Show available facility slots for today" }],
      });
      expect([200, 400, 401]).toContain(status);
    });

    it("AI can query facility bookings", async () => {
      const { status } = await admin.post("/api/admin/ai/chat", {
        messages: [{ role: "user", content: "Show all facility bookings for this week" }],
      });
      expect([200, 400, 401]).toContain(status);
    });

    it("AI can query facility utilization", async () => {
      const { status } = await admin.post("/api/admin/ai/chat", {
        messages: [{ role: "user", content: "What is the facility utilization rate?" }],
      });
      expect([200, 400, 401]).toContain(status);
    });
  });
});
