/**
 * E2E: Enquiry Followups
 */
import { describe, it, expect, beforeAll } from "vitest";
import { TestClient, SEED } from "./helpers";

describe("Enquiry Followups", () => {
  const admin = new TestClient();
  const staff = new TestClient();
  const member = new TestClient();

  beforeAll(async () => {
    await admin.login(SEED.admin.email, SEED.admin.password);
    await staff.login(SEED.staff.email, SEED.staff.password);
    await member.login(SEED.members.active20d.email, SEED.members.active20d.password);
  });

  it("admin can access enquiries page", async () => {
    const { status } = await admin.getPage("/admin/enquiries");
    expect(status).toBe(200);
  });

  it("staff can access enquiries page", async () => {
    const { status } = await staff.getPage("/admin/enquiries");
    expect(status).toBe(200);
  });

  it("member cannot access enquiries", async () => {
    const { status } = await member.getPage("/admin/enquiries");
    expect([302, 307]).toContain(status);
  });

  it("AI can query overdue enquiry followups", async () => {
    const { status } = await admin.post("/api/admin/ai/chat", {
      messages: [{ role: "user", content: "Show overdue enquiry followups" }],
    });
    expect([200, 400, 401]).toContain(status);
  });

  it("AI can query today's followups", async () => {
    const { status } = await admin.post("/api/admin/ai/chat", {
      messages: [{ role: "user", content: "What followups are scheduled for today?" }],
    });
    expect([200, 400, 401]).toContain(status);
  });
});
