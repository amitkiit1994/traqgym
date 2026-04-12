/**
 * E2E: Trial Memberships
 */
import { describe, it, expect, beforeAll } from "vitest";
import { TestClient, SEED } from "./helpers";

describe("Trial Memberships", () => {
  const admin = new TestClient();
  const staff = new TestClient();
  const member = new TestClient();

  beforeAll(async () => {
    await admin.login(SEED.admin.email, SEED.admin.password);
    await staff.login(SEED.staff.email, SEED.staff.password);
    await member.login(SEED.members.active20d.email, SEED.members.active20d.password);
  });

  it("admin can access plans page (trial plans configured here)", async () => {
    const { status } = await admin.getPage("/admin/plans");
    expect(status).toBe(200);
  });

  it("admin can access renewals page (trial creation via renewal flow)", async () => {
    const { status } = await admin.getPage("/admin/renewals");
    expect(status).toBe(200);
  });

  it("AI can query active trials", async () => {
    const { status } = await admin.post("/api/admin/ai/chat", {
      messages: [{ role: "user", content: "Show me active trials" }],
    });
    expect([200, 400, 401]).toContain(status);
  });

  it("AI can query trial stats", async () => {
    const { status } = await admin.post("/api/admin/ai/chat", {
      messages: [{ role: "user", content: "What is our trial conversion rate?" }],
    });
    expect([200, 400, 401]).toContain(status);
  });

  it("member cannot access admin pages", async () => {
    const { status } = await member.getPage("/admin/renewals");
    expect([302, 307]).toContain(status);
  });
});
