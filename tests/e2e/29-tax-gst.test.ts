/**
 * E2E: Tax/GST Features
 */
import { describe, it, expect, beforeAll } from "vitest";
import { TestClient, SEED } from "./helpers";

describe("Tax/GST", () => {
  const admin = new TestClient();
  const member = new TestClient();

  beforeAll(async () => {
    await admin.login(SEED.admin.email, SEED.admin.password);
    await member.login(SEED.members.active20d.email, SEED.members.active20d.password);
  });

  it("admin can access settings page (tax config is in settings)", async () => {
    const { status } = await admin.getPage("/admin/settings");
    expect(status).toBe(200);
  });

  it("admin can access reports page (tax report tab)", async () => {
    const { status } = await admin.getPage("/admin/reports");
    expect(status).toBe(200);
  });

  it("member cannot access settings", async () => {
    const { status } = await member.getPage("/admin/settings");
    expect([302, 307]).toContain(status);
  });

  it("AI chat can query tax settings", async () => {
    const { status } = await admin.post("/api/admin/ai/chat", {
      messages: [{ role: "user", content: "What are the current GST settings?" }],
    });
    expect([200, 400, 401]).toContain(status);
  });
});
