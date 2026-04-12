/**
 * E2E: Expenses CRUD & Summary
 */
import { describe, it, expect, beforeAll } from "vitest";
import { TestClient, AnonClient, SEED } from "./helpers";

describe("Expenses", () => {
  const admin = new TestClient();
  const staff = new TestClient();
  const member = new TestClient();

  beforeAll(async () => {
    await admin.login(SEED.admin.email, SEED.admin.password);
    await staff.login(SEED.staff.email, SEED.staff.password);
    await member.login(SEED.members.active20d.email, SEED.members.active20d.password);
  });

  it("admin can access expenses page", async () => {
    const { status } = await admin.getPage("/admin/expenses");
    expect(status).toBe(200);
  });

  it("staff can access expenses page", async () => {
    const { status } = await staff.getPage("/admin/expenses");
    expect(status).toBe(200);
  });

  it("member cannot access expenses page", async () => {
    const { status } = await member.getPage("/admin/expenses");
    expect([302, 307]).toContain(status);
  });
});
