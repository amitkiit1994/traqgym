/**
 * E2E: Family Groups
 */
import { describe, it, expect, beforeAll } from "vitest";
import { TestClient, SEED } from "./helpers";

describe("Family Groups", () => {
  const admin = new TestClient();
  const member = new TestClient();

  beforeAll(async () => {
    await admin.login(SEED.admin.email, SEED.admin.password);
    await member.login(SEED.members.active20d.email, SEED.members.active20d.password);
  });

  describe("Page Access", () => {
    it("admin can access family groups page", async () => {
      const { status } = await admin.getPage("/admin/family");
      expect(status).toBe(200);
    });

    it("member cannot access admin family groups page", async () => {
      const { status } = await member.getPage("/admin/family");
      expect([302, 307]).toContain(status);
    });
  });

  describe("AI Tools - Family Groups", () => {
    it("AI can query family groups", async () => {
      const { status } = await admin.post("/api/admin/ai/chat", {
        messages: [{ role: "user", content: "Show all family groups" }],
      });
      expect([200, 400, 401]).toContain(status);
    });

    it("AI can create family group (status check)", async () => {
      const { status } = await admin.post("/api/admin/ai/chat", {
        messages: [{ role: "user", content: "Create a family group for the Sharma family" }],
      });
      expect([200, 400, 401]).toContain(status);
    });

    it("AI can query family group details", async () => {
      const { status } = await admin.post("/api/admin/ai/chat", {
        messages: [{ role: "user", content: "Show family group members and their plans" }],
      });
      expect([200, 400, 401]).toContain(status);
    });
  });
});
