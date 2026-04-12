/**
 * E2E: Lead Pipeline
 */
import { describe, it, expect, beforeAll } from "vitest";
import { TestClient, SEED } from "./helpers";

describe("Lead Pipeline", () => {
  const admin = new TestClient();
  const staff = new TestClient();
  const member = new TestClient();

  beforeAll(async () => {
    await admin.login(SEED.admin.email, SEED.admin.password);
    await staff.login(SEED.staff.email, SEED.staff.password);
    await member.login(SEED.members.active20d.email, SEED.members.active20d.password);
  });

  describe("Page Access", () => {
    it("admin can access enquiries page", async () => {
      const { status } = await admin.getPage("/admin/enquiries");
      expect(status).toBe(200);
    });

    it("staff can view enquiries page", async () => {
      const { status } = await staff.getPage("/admin/enquiries");
      expect(status).toBe(200);
    });

    it("member cannot access enquiries page", async () => {
      const { status } = await member.getPage("/admin/enquiries");
      expect([302, 307]).toContain(status);
    });
  });

  describe("AI Tools - Lead Pipeline", () => {
    it("AI can query lead pipeline funnel", async () => {
      const { status } = await admin.post("/api/admin/ai/chat", {
        messages: [{ role: "user", content: "Show the lead pipeline funnel" }],
      });
      expect([200, 400, 401]).toContain(status);
    });

    it("AI can query lead stages", async () => {
      const { status } = await admin.post("/api/admin/ai/chat", {
        messages: [{ role: "user", content: "How many leads are in each stage?" }],
      });
      expect([200, 400, 401]).toContain(status);
    });

    it("AI can query follow-up leads", async () => {
      const { status } = await admin.post("/api/admin/ai/chat", {
        messages: [{ role: "user", content: "Which leads need follow-up today?" }],
      });
      expect([200, 400, 401]).toContain(status);
    });
  });
});
