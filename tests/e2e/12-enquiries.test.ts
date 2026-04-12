/**
 * E2E: Enquiries CRUD & Conversion
 */
import { describe, it, expect, beforeAll } from "vitest";
import { TestClient, AnonClient, SEED } from "./helpers";

describe("Enquiries", () => {
  const admin = new TestClient();
  const member = new TestClient();
  const anon = new AnonClient();

  beforeAll(async () => {
    await admin.login(SEED.admin.email, SEED.admin.password);
    await member.login(SEED.members.active20d.email, SEED.members.active20d.password);
  });

  it("admin can access enquiries page", async () => {
    const { status } = await admin.getPage("/admin/enquiries");
    expect(status).toBe(200);
  });

  it("member cannot access enquiries page", async () => {
    const { status } = await member.getPage("/admin/enquiries");
    expect([302, 307]).toContain(status);
  });

  it("anon is redirected from enquiries page", async () => {
    const { status } = await anon.get("/admin/enquiries");
    expect([302, 307]).toContain(status);
  });
});
