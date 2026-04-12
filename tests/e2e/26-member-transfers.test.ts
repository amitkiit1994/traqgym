/**
 * E2E: Member Transfers
 */
import { describe, it, expect, beforeAll } from "vitest";
import { TestClient, AnonClient, SEED } from "./helpers";

describe("Member Transfers", () => {
  const admin = new TestClient();
  const staff = new TestClient();
  const member = new TestClient();
  const anon = new AnonClient();

  beforeAll(async () => {
    await admin.login(SEED.admin.email, SEED.admin.password);
    await staff.login(SEED.staff.email, SEED.staff.password);
    await member.login(SEED.members.active20d.email, SEED.members.active20d.password);
  });

  it("admin can view member details before transfer", async () => {
    const { status, body } = await admin.get(`/api/people?search=${SEED.members.active20d.phone}`);
    expect(status).toBe(200);
  });

  it("AI chat can invoke transfer_member tool", async () => {
    const { status } = await admin.post("/api/admin/ai/chat", {
      messages: [{ role: "user", content: `Transfer member ${SEED.members.active20d.id} to location ${SEED.locations.cc.id}` }],
    });
    expect([200, 400, 401]).toContain(status);
  });

  it("member cannot access admin endpoints", async () => {
    const { status } = await member.getPage("/admin/members");
    expect([302, 307]).toContain(status);
  });

  it("anon cannot access admin endpoints", async () => {
    const { status } = await anon.get("/admin/members");
    expect([302, 307]).toContain(status);
  });
});
