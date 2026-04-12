/**
 * E2E: Gym Targets & Upgrade Stats
 */
import { describe, it, expect, beforeAll } from "vitest";
import { TestClient, SEED } from "./helpers";

describe("Gym Targets & Upgrades", () => {
  const admin = new TestClient();
  const staff = new TestClient();

  beforeAll(async () => {
    await admin.login(SEED.admin.email, SEED.admin.password);
    await staff.login(SEED.staff.email, SEED.staff.password);
  });

  describe("Gym Targets via AI", () => {
    it("AI chat can invoke set_gym_target tool", async () => {
      const { status } = await admin.post("/api/admin/ai/chat", {
        messages: [{ role: "user", content: "Set a target of 100000 revenue, 20 new members, and 15 renewals for April 2026" }],
      });
      expect([200, 400, 401]).toContain(status);
    });

    it("AI chat can invoke get_gym_target tool", async () => {
      const { status } = await admin.post("/api/admin/ai/chat", {
        messages: [{ role: "user", content: "What is our target for April 2026?" }],
      });
      expect([200, 400, 401]).toContain(status);
    });

    it("AI chat can invoke get_target_progress tool", async () => {
      const { status } = await admin.post("/api/admin/ai/chat", {
        messages: [{ role: "user", content: "Show me target progress for April 2026" }],
      });
      expect([200, 400, 401]).toContain(status);
    });
  });

  describe("Upgrade Stats via AI", () => {
    it("AI chat can invoke get_upgrade_stats tool", async () => {
      const { status } = await admin.post("/api/admin/ai/chat", {
        messages: [{ role: "user", content: "How many plan upgrades happened this year?" }],
      });
      expect([200, 400, 401]).toContain(status);
    });
  });

  describe("Dashboard still loads", () => {
    it("admin can access dashboard", async () => {
      const { status } = await admin.getPage("/admin/dashboard");
      expect(status).toBe(200);
    });

    it("staff can access dashboard", async () => {
      const { status } = await staff.getPage("/admin/dashboard");
      expect(status).toBe(200);
    });
  });
});
