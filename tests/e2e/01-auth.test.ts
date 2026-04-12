/**
 * E2E: Authentication & Access Control
 */
import { describe, it, expect, beforeAll } from "vitest";
import { TestClient, AnonClient, SEED } from "./helpers";

describe("Authentication", () => {
  const admin = new TestClient();
  const staff = new TestClient();
  const member = new TestClient();
  const anon = new AnonClient();

  beforeAll(async () => {
    await admin.login(SEED.admin.email, SEED.admin.password);
    await staff.login(SEED.staff.email, SEED.staff.password);
    await member.login(SEED.members.active20d.email, SEED.members.active20d.password);
  });

  // ---- Login flows ----

  it("admin login returns correct session", async () => {
    const { body } = await admin.get("/api/auth/session");
    expect(body.user.email).toBe(SEED.admin.email);
    expect(body.user.actorType).toBe("worker");
    expect(body.user.role).toBe("admin");
  });

  it("staff login returns correct session", async () => {
    const { body } = await staff.get("/api/auth/session");
    expect(body.user.email).toBe(SEED.staff.email);
    expect(body.user.actorType).toBe("worker");
    expect(body.user.role).toBe("staff");
  });

  it("member login returns correct session", async () => {
    const { body } = await member.get("/api/auth/session");
    expect(body.user.email).toBe(SEED.members.active20d.email);
    expect(body.user.actorType).toBe("member");
    expect(body.user.role).toBe("member");
  });

  it("invalid credentials return error", async () => {
    const badClient = new TestClient();
    const { ok } = await badClient.login("admin@gym.com", "wrongpassword");
    const { body } = await badClient.get("/api/auth/session");
    expect(body.user).toBeUndefined();
  });

  // ---- Page access: unauthenticated ----

  it("unauthenticated user is redirected from /admin/dashboard", async () => {
    const { status } = await anon.get("/admin/dashboard");
    expect([302, 307]).toContain(status);
  });

  it("unauthenticated user is redirected from /member", async () => {
    const { status } = await anon.get("/member");
    expect([302, 307]).toContain(status);
  });

  it("unauthenticated user can access /kiosk", async () => {
    const { status } = await anon.get("/kiosk");
    expect(status).toBe(200);
  });

  it("unauthenticated user can access /login", async () => {
    const { status } = await anon.get("/login");
    expect(status).toBe(200);
  });

  // ---- Page access: cross-role ----

  it("member cannot access admin pages", async () => {
    const { status } = await member.getPage("/admin/dashboard");
    expect([302, 307]).toContain(status);
  });

  it("member cannot access admin members page", async () => {
    const { status } = await member.getPage("/admin/members");
    expect([302, 307]).toContain(status);
  });

  // ---- Admin page access ----

  const adminPages = [
    "/admin/dashboard", "/admin/members", "/admin/plans", "/admin/locations",
    "/admin/workers", "/admin/renewals", "/admin/attendance", "/admin/classes",
    "/admin/enquiries", "/admin/promos", "/admin/expenses", "/admin/audit",
    "/admin/reports", "/admin/settings", "/admin/announcements", "/admin/equipment",
    "/admin/notifications", "/admin/biometric", "/admin/bulk-notify",
    "/admin/staff-performance", "/admin/activity", "/admin/leaves", "/admin/my-dashboard",
  ];

  for (const page of adminPages) {
    it(`admin can access ${page}`, async () => {
      const { status } = await admin.getPage(page);
      expect(status).toBe(200);
    });
  }

  // ---- Staff restricted pages ----

  it("staff can access /admin/dashboard", async () => {
    const { status } = await staff.getPage("/admin/dashboard");
    expect(status).toBe(200);
  });

  it("staff can access /admin/members", async () => {
    const { status } = await staff.getPage("/admin/members");
    expect(status).toBe(200);
  });

  it("staff can access /admin/attendance", async () => {
    const { status } = await staff.getPage("/admin/attendance");
    expect(status).toBe(200);
  });

  // ---- Member page access ----

  const memberPages = [
    "/member", "/member/stats", "/member/profile",
    "/member/invoices", "/member/measurements", "/member/classes",
  ];

  for (const page of memberPages) {
    it(`member can access ${page}`, async () => {
      const { status } = await member.getPage(page);
      expect(status).toBe(200);
    });
  }

  // ---- API access control ----

  it("unauthenticated cannot access settings API", async () => {
    const { status } = await anon.get("/api/admin/settings");
    expect(status).toBe(401);
  });

  it("unauthenticated cannot access plan-change API", async () => {
    const { status } = await anon.post("/api/admin/plan-change", {});
    expect(status).toBe(401);
  });

  it("member cannot access settings API", async () => {
    const { status } = await member.get("/api/admin/settings");
    expect(status).toBe(401);
  });

  it("admin can access settings API", async () => {
    const { status } = await admin.get("/api/admin/settings");
    expect(status).toBe(200);
  });
});
