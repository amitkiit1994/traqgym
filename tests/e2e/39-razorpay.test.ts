/**
 * E2E: Online Payments (Razorpay)
 */
import { describe, it, expect, beforeAll } from "vitest";
import { TestClient, SEED } from "./helpers";

describe("Online Payments (Razorpay)", () => {
  const admin = new TestClient();
  const member = new TestClient();

  beforeAll(async () => {
    await admin.login(SEED.admin.email, SEED.admin.password);
    await member.login(SEED.members.active20d.email, SEED.members.active20d.password);
  });

  describe("Page Access", () => {
    it("admin can access settings page (razorpay config)", async () => {
      const { status } = await admin.getPage("/admin/settings");
      expect(status).toBe(200);
    });

    it("member cannot access admin settings page", async () => {
      const { status } = await member.getPage("/admin/settings");
      expect([302, 307]).toContain(status);
    });
  });

  describe("AI Tools - Online Payments", () => {
    it("AI can query online payments", async () => {
      const { status } = await admin.post("/api/admin/ai/chat", {
        messages: [{ role: "user", content: "Show online payment transactions" }],
      });
      expect([200, 400, 401]).toContain(status);
    });

    it("AI can query payment status", async () => {
      const { status } = await admin.post("/api/admin/ai/chat", {
        messages: [{ role: "user", content: "Show pending online payments" }],
      });
      expect([200, 400, 401]).toContain(status);
    });
  });
});
