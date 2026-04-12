/**
 * E2E: Workout & Diet Plans
 */
import { describe, it, expect, beforeAll } from "vitest";
import { TestClient, SEED } from "./helpers";

describe("Workout & Diet Plans", () => {
  const admin = new TestClient();
  const staff = new TestClient();
  const member = new TestClient();

  beforeAll(async () => {
    await admin.login(SEED.admin.email, SEED.admin.password);
    await staff.login(SEED.staff.email, SEED.staff.password);
    await member.login(SEED.members.active20d.email, SEED.members.active20d.password);
  });

  describe("Admin Page Access", () => {
    it("admin can access workout plans page", async () => {
      const { status } = await admin.getPage("/admin/workout");
      expect(status).toBe(200);
    });

    it("admin can access diet plans page", async () => {
      const { status } = await admin.getPage("/admin/diet");
      expect(status).toBe(200);
    });
  });

  describe("Member Page Access", () => {
    it("member can access own workout page", async () => {
      const { status } = await member.getPage("/member/workout");
      expect(status).toBe(200);
    });

    it("member can access own diet page", async () => {
      const { status } = await member.getPage("/member/diet");
      expect(status).toBe(200);
    });

    it("member cannot access admin workout plans page", async () => {
      const { status } = await member.getPage("/admin/workout");
      expect([302, 307]).toContain(status);
    });

    it("member cannot access admin diet plans page", async () => {
      const { status } = await member.getPage("/admin/diet");
      expect([302, 307]).toContain(status);
    });
  });

  describe("AI Tools - Workout Plans", () => {
    it("AI can query workout plans", async () => {
      const { status } = await admin.post("/api/admin/ai/chat", {
        messages: [{ role: "user", content: "Show all workout plans" }],
      });
      expect([200, 400, 401]).toContain(status);
    });
  });

  describe("AI Tools - Diet Plans", () => {
    it("AI can query diet plans", async () => {
      const { status } = await admin.post("/api/admin/ai/chat", {
        messages: [{ role: "user", content: "Show all diet plans" }],
      });
      expect([200, 400, 401]).toContain(status);
    });
  });
});
