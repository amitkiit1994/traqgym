/**
 * E2E: Partial Payments & Balance Due
 */
import { describe, it, expect, beforeAll } from "vitest";
import { TestClient, SEED } from "./helpers";

describe("Partial Payments & Balance Due", () => {
  const admin = new TestClient();
  const staff = new TestClient();
  const member = new TestClient();

  beforeAll(async () => {
    await admin.login(SEED.admin.email, SEED.admin.password);
    await staff.login(SEED.staff.email, SEED.staff.password);
    await member.login(SEED.members.active20d.email, SEED.members.active20d.password);
  });

  it("admin can access balance-due page", async () => {
    const { status } = await admin.getPage("/admin/balance-due");
    expect(status).toBe(200);
  });

  it("staff can access balance-due page", async () => {
    const { status } = await staff.getPage("/admin/balance-due");
    expect(status).toBe(200);
  });

  it("member cannot access balance-due page", async () => {
    const { status } = await member.getPage("/admin/balance-due");
    expect([302, 307]).toContain(status);
  });

  it("admin can access followups page", async () => {
    const { status } = await admin.getPage("/admin/followups");
    expect(status).toBe(200);
  });

  it("staff can access followups page", async () => {
    const { status } = await staff.getPage("/admin/followups");
    expect(status).toBe(200);
  });

  it("member cannot access followups page", async () => {
    const { status } = await member.getPage("/admin/followups");
    expect([302, 307]).toContain(status);
  });
});
