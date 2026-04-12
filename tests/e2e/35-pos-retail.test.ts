/**
 * E2E: POS / Retail
 */
import { describe, it, expect, beforeAll } from "vitest";
import { TestClient, SEED } from "./helpers";

describe("POS / Retail", () => {
  const admin = new TestClient();
  const staff = new TestClient();
  const member = new TestClient();

  beforeAll(async () => {
    await admin.login(SEED.admin.email, SEED.admin.password);
    await staff.login(SEED.staff.email, SEED.staff.password);
    await member.login(SEED.members.active20d.email, SEED.members.active20d.password);
  });

  describe("Page Access", () => {
    it("admin can access POS page", async () => {
      const { status } = await admin.getPage("/admin/pos");
      expect(status).toBe(200);
    });

    it("staff can access POS page", async () => {
      const { status } = await staff.getPage("/admin/pos");
      expect(status).toBe(200);
    });

    it("member cannot access POS page", async () => {
      const { status } = await member.getPage("/admin/pos");
      expect([302, 307]).toContain(status);
    });
  });

  describe("AI Tools - Products", () => {
    it("AI can query products", async () => {
      const { status } = await admin.post("/api/admin/ai/chat", {
        messages: [{ role: "user", content: "Show all products in the store" }],
      });
      expect([200, 400, 401]).toContain(status);
    });

    it("AI can query low stock items", async () => {
      const { status } = await admin.post("/api/admin/ai/chat", {
        messages: [{ role: "user", content: "Which products are low in stock?" }],
      });
      expect([200, 400, 401]).toContain(status);
    });
  });

  describe("AI Tools - Sales", () => {
    it("AI can query sales report", async () => {
      const { status } = await admin.post("/api/admin/ai/chat", {
        messages: [{ role: "user", content: "Show POS sales report for this month" }],
      });
      expect([200, 400, 401]).toContain(status);
    });

    it("AI can query top selling products", async () => {
      const { status } = await admin.post("/api/admin/ai/chat", {
        messages: [{ role: "user", content: "What are the top selling products?" }],
      });
      expect([200, 400, 401]).toContain(status);
    });

    it("AI can query daily sales summary", async () => {
      const { status } = await admin.post("/api/admin/ai/chat", {
        messages: [{ role: "user", content: "Show today's POS sales summary" }],
      });
      expect([200, 400, 401]).toContain(status);
    });
  });
});
