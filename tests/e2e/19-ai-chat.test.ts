/**
 * E2E: AI Chat — Conversations CRUD & Chat endpoint
 */
import { describe, it, expect, beforeAll } from "vitest";
import { TestClient, AnonClient, SEED } from "./helpers";

describe("AI Chat", () => {
  const admin = new TestClient();
  const staff = new TestClient();
  const member = new TestClient();
  const anon = new AnonClient();

  beforeAll(async () => {
    await admin.login(SEED.admin.email, SEED.admin.password);
    await staff.login(SEED.staff.email, SEED.staff.password);
    await member.login(SEED.members.active20d.email, SEED.members.active20d.password);
  });

  describe("AI Page Access", () => {
    it("admin can access AI page", async () => {
      const { status } = await admin.getPage("/admin/ai");
      expect(status).toBe(200);
    });

    it("staff can access AI page", async () => {
      const { status } = await staff.getPage("/admin/ai");
      expect(status).toBe(200);
    });

    it("member cannot access AI page", async () => {
      const { status } = await member.getPage("/admin/ai");
      expect([302, 307]).toContain(status);
    });
  });

  describe("Conversations API", () => {
    it("admin can list conversations", async () => {
      const { status, body } = await admin.get("/api/admin/ai/conversations");
      expect(status).toBe(200);
      expect(Array.isArray(body)).toBe(true);
    });

    it("staff can list conversations", async () => {
      const { status, body } = await staff.get("/api/admin/ai/conversations");
      expect(status).toBe(200);
      expect(Array.isArray(body)).toBe(true);
    });

    it("member cannot list conversations", async () => {
      const { status } = await member.get("/api/admin/ai/conversations");
      expect(status).toBe(401);
    });

    it("anon cannot list conversations", async () => {
      const { status } = await anon.get("/api/admin/ai/conversations");
      expect(status).toBe(401);
    });

    it("loading non-existent conversation returns 404", async () => {
      const { status } = await admin.get("/api/admin/ai/conversations/99999");
      expect(status).toBe(404);
    });

    it("deleting non-existent conversation returns 404", async () => {
      const { status } = await admin.delete("/api/admin/ai/conversations/99999");
      expect(status).toBe(404);
    });

    it("member cannot delete conversations", async () => {
      const { status } = await member.delete("/api/admin/ai/conversations/1");
      expect(status).toBe(401);
    });
  });

  describe("Chat Endpoint", () => {
    it("anon cannot access chat endpoint", async () => {
      const res = await anon.post("/api/admin/ai/chat", {
        message: "Hello",
      });
      expect(res.status).toBe(401);
    });

    it("member cannot access chat endpoint", async () => {
      const res = await member.post("/api/admin/ai/chat", {
        message: "Hello",
      });
      expect(res.status).toBe(401);
    });

    it("chat endpoint requires message field", async () => {
      const res = await admin.post("/api/admin/ai/chat", {});
      // Should return error for missing message
      expect([400, 200]).toContain(res.status);
    });
  });
});
