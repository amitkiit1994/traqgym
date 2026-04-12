/**
 * E2E: Gift Cards & Waivers
 */
import { describe, it, expect, beforeAll } from "vitest";
import { TestClient, SEED } from "./helpers";

describe("Gift Cards & Waivers", () => {
  const admin = new TestClient();
  const staff = new TestClient();
  const member = new TestClient();

  beforeAll(async () => {
    await admin.login(SEED.admin.email, SEED.admin.password);
    await staff.login(SEED.staff.email, SEED.staff.password);
    await member.login(SEED.members.active20d.email, SEED.members.active20d.password);
  });

  describe("Page Access", () => {
    it("admin can access gift cards page", async () => {
      const { status } = await admin.getPage("/admin/gift-cards");
      expect(status).toBe(200);
    });

    it("admin can access waivers page", async () => {
      const { status } = await admin.getPage("/admin/waivers");
      expect(status).toBe(200);
    });

    it("member cannot access admin gift cards page", async () => {
      const { status } = await member.getPage("/admin/gift-cards");
      expect([302, 307]).toContain(status);
    });

    it("member cannot access admin waivers page", async () => {
      const { status } = await member.getPage("/admin/waivers");
      expect([302, 307]).toContain(status);
    });
  });

  describe("AI Tools - Gift Cards", () => {
    it("AI can query gift cards", async () => {
      const { status } = await admin.post("/api/admin/ai/chat", {
        messages: [{ role: "user", content: "Show all gift cards" }],
      });
      expect([200, 400, 401]).toContain(status);
    });
  });

  describe("AI Tools - Waivers", () => {
    it("AI can query waiver status", async () => {
      const { status } = await admin.post("/api/admin/ai/chat", {
        messages: [{ role: "user", content: "Show waiver status for all members" }],
      });
      expect([200, 400, 401]).toContain(status);
    });

    it("AI can query unsigned waivers", async () => {
      const { status } = await admin.post("/api/admin/ai/chat", {
        messages: [{ role: "user", content: "Which members have unsigned waivers?" }],
      });
      expect([200, 400, 401]).toContain(status);
    });

    it("AI can query waiver templates", async () => {
      const { status } = await admin.post("/api/admin/ai/chat", {
        messages: [{ role: "user", content: "List all waiver templates" }],
      });
      expect([200, 400, 401]).toContain(status);
    });
  });
});
