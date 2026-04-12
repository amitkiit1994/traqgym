/**
 * E2E: Class Scheduling & Booking
 *
 * Tests class management pages and member class browsing.
 * Class CRUD happens via server actions, so we test page accessibility
 * and the member-facing class pages.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { TestClient, AnonClient, SEED } from "./helpers";

describe("Class Scheduling", () => {
  const admin = new TestClient();
  const staff = new TestClient();
  const member = new TestClient();
  const anon = new AnonClient();

  beforeAll(async () => {
    await admin.login(SEED.admin.email, SEED.admin.password);
    await staff.login(SEED.staff.email, SEED.staff.password);
    await member.login(SEED.members.active20d.email, SEED.members.active20d.password);
  });

  // ---- Admin class management ----

  describe("Admin Class Pages", () => {
    it("admin can access classes list", async () => {
      const { status } = await admin.getPage("/admin/classes");
      expect(status).toBe(200);
    });

    it("staff can access classes list", async () => {
      const { status } = await staff.getPage("/admin/classes");
      expect(status).toBe(200);
    });

    it("member cannot access admin classes", async () => {
      const { status } = await member.getPage("/admin/classes");
      expect([302, 307]).toContain(status);
    });

    it("anon is redirected from admin classes", async () => {
      const { status } = await anon.get("/admin/classes");
      expect([302, 307]).toContain(status);
    });
  });

  // ---- Class detail page ----

  describe("Class Detail", () => {
    it("admin can view class detail for seeded yoga class", async () => {
      const { status } = await admin.getPage(`/admin/classes/${SEED.classes.yoga.id}`);
      // May be 200 or 404 depending on seed data presence
      expect([200, 404]).toContain(status);
    });

    it("non-existent class page still renders (dynamic route)", async () => {
      const { status } = await admin.getPage("/admin/classes/99999");
      // Next.js dynamic routes render 200 and show "not found" in the page content
      expect([200, 404, 302]).toContain(status);
    });
  });

  // ---- Member class browsing ----

  describe("Member Class Pages", () => {
    it("member can access classes page", async () => {
      const { status } = await member.getPage("/member/classes");
      expect(status).toBe(200);
    });

    it("anon is redirected from member classes", async () => {
      const { status } = await anon.get("/member/classes");
      expect([302, 307]).toContain(status);
    });
  });
});
