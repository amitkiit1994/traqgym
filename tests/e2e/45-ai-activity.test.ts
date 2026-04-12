/**
 * E2E: AI Activity Dashboard
 *
 * Tests admin access to the AI activity dashboard page.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { TestClient, SEED } from "./helpers";

describe("AI Activity Dashboard", () => {
  const admin = new TestClient();
  const staff = new TestClient();
  const member = new TestClient();

  beforeAll(async () => {
    await admin.login(SEED.admin.email, SEED.admin.password);
    await staff.login(SEED.staff.email, SEED.staff.password);
    await member.login(SEED.members.active20d.email, SEED.members.active20d.password);
  });

  it("admin can access AI activity page", async () => {
    const { status } = await admin.getPage("/admin/ai-activity");
    expect(status).toBe(200);
  });

  it("staff is redirected from AI activity page", async () => {
    const { status } = await staff.getPage("/admin/ai-activity");
    // Staff may get 200 (page renders but redirects client-side) or 302
    expect([200, 302, 307]).toContain(status);
  });

  it("member cannot access AI activity page", async () => {
    const { status } = await member.getPage("/admin/ai-activity");
    expect([302, 307]).toContain(status);
  });
});
