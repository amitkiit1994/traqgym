/**
 * E2E: Auth & Security — role boundaries, cron exposure, API auth, invalid logins
 */
import { describe, it, expect, beforeAll } from "vitest";
import { TestClient, AnonClient, SEED } from "./helpers";

describe("Auth & Security", () => {
  const admin = new TestClient();
  const staff = new TestClient();
  const member = new TestClient();
  const anon = new AnonClient();

  beforeAll(async () => {
    await admin.login(SEED.admin.email, SEED.admin.password);
    await staff.login(SEED.staff.email, SEED.staff.password);
    await member.login(
      SEED.members.active20d.email,
      SEED.members.active20d.password
    );
  });

  // ────────────────────────────────────────────
  // 1. Role-based access control
  // ────────────────────────────────────────────

  describe("RBAC — staff restrictions", () => {
    it("staff cannot access /admin/workers", async () => {
      const { status } = await staff.getPage("/admin/workers");
      expect([302, 307]).toContain(status);
    });

    it("staff cannot access /admin/reports", async () => {
      const { status } = await staff.getPage("/admin/reports");
      expect([302, 307]).toContain(status);
    });
  });

  describe("RBAC — member blocked from admin", () => {
    const adminPaths = [
      "/admin/dashboard",
      "/admin/members",
      "/admin/workers",
      "/admin/reports",
      "/admin/settings",
      "/admin/plans",
      "/admin/renewals",
    ];

    for (const path of adminPaths) {
      it(`member redirected from ${path}`, async () => {
        const { status } = await member.getPage(path);
        expect([302, 307]).toContain(status);
      });
    }
  });

  describe("RBAC — worker blocked from member pages", () => {
    const memberPaths = [
      "/member",
      "/member/stats",
      "/member/profile",
      "/member/invoices",
    ];

    for (const path of memberPaths) {
      it(`admin (worker) redirected from ${path}`, async () => {
        const { status } = await admin.getPage(path);
        expect([302, 307]).toContain(status);
      });
    }
  });

  describe("RBAC — anon blocked from protected pages", () => {
    it("anon redirected from /admin/dashboard", async () => {
      const { status } = await anon.get("/admin/dashboard");
      expect([302, 307]).toContain(status);
    });

    it("anon redirected from /member", async () => {
      const { status } = await anon.get("/member");
      expect([302, 307]).toContain(status);
    });
  });

  // ────────────────────────────────────────────
  // 2. Cron endpoints — Sprint 8 closed the gap with requireCronSecret
  // ────────────────────────────────────────────

  describe("Cron endpoints reject anonymous callers (Sprint 8)", () => {
    const cronPaths = [
      "/api/cron/auto-checkout",
      "/api/cron/re-engagement",
      "/api/cron/ai-churn-alerts",
      "/api/cron/ai-lead-followup",
      "/api/cron/member-milestones",
      "/api/cron/renewal-reminders",
      "/api/cron/ai-member-nudges",
      "/api/cron/ai-daily-briefing",
      "/api/cron/ai-weekly-summary",
    ];

    for (const path of cronPaths) {
      it(`anon GET ${path} is rejected`, async () => {
        const { status } = await anon.get(path);
        // requireCronSecret returns 401 (missing/invalid header) or 503 (no env).
        // Both are valid — invariant is "not 200 for anon".
        expect([401, 503]).toContain(status);
      });
    }
  });

  // ────────────────────────────────────────────
  // 3. API route auth
  // ────────────────────────────────────────────

  describe("API route auth — anon blocked", () => {
    it("anon POST to /api/admin/settings fails", async () => {
      const { status } = await anon.post("/api/admin/settings", {
        gymName: "Hacked Gym",
      });
      expect([401, 302, 307]).toContain(status);
    });

    it("anon POST to /api/admin/ai/chat fails", async () => {
      const { status } = await anon.post("/api/admin/ai/chat", {
        message: "hello",
      });
      expect([401, 302, 307]).toContain(status);
    });
  });

  describe("API route auth — member blocked from admin APIs", () => {
    it("member POST to /api/admin/settings fails", async () => {
      const { status } = await member.post("/api/admin/settings", {
        gymName: "Hacked Gym",
      });
      expect([401, 403]).toContain(status);
    });

    it("member POST to /api/admin/ai/chat fails", async () => {
      const { status } = await member.post("/api/admin/ai/chat", {
        message: "hello",
      });
      expect([401, 403]).toContain(status);
    });

    it("member POST to /api/admin/plan-change fails", async () => {
      const { status } = await member.post("/api/admin/plan-change", {});
      expect([401, 403]).toContain(status);
    });
  });

  // ────────────────────────────────────────────
  // 4. Invalid login attempts
  // ────────────────────────────────────────────

  describe("Invalid login attempts", () => {
    it("wrong password does not create a session", async () => {
      const client = new TestClient();
      const { ok } = await client.login("admin@gym.com", "wrongpassword");
      const { body } = await client.get("/api/auth/session");
      expect(body.user).toBeUndefined();
    });

    it("non-existent email does not create a session", async () => {
      const client = new TestClient();
      const { ok } = await client.login("nobody@nowhere.com", "password123");
      const { body } = await client.get("/api/auth/session");
      expect(body.user).toBeUndefined();
    });

    it("empty credentials do not create a session", async () => {
      const client = new TestClient();
      const { ok } = await client.login("", "");
      const { body } = await client.get("/api/auth/session");
      expect(body.user).toBeUndefined();
    });
  });
});
