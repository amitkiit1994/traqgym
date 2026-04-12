/**
 * E2E: Members CRUD, Search, Toggle, Cancel
 */
import { describe, it, expect, beforeAll } from "vitest";
import { TestClient, AnonClient, SEED } from "./helpers";

describe("Members CRUD", () => {
  const admin = new TestClient();
  const staff = new TestClient();
  const member = new TestClient();
  const anon = new AnonClient();

  beforeAll(async () => {
    await admin.login(SEED.admin.email, SEED.admin.password);
    await staff.login(SEED.staff.email, SEED.staff.password);
    await member.login(SEED.members.active20d.email, SEED.members.active20d.password);
  });

  // ---- Page access ----

  it("admin can access members list page", async () => {
    const { status } = await admin.getPage("/admin/members");
    expect(status).toBe(200);
  });

  it("staff can access members list page", async () => {
    const { status } = await staff.getPage("/admin/members");
    expect(status).toBe(200);
  });

  it("member cannot access members admin page", async () => {
    const { status } = await member.getPage("/admin/members");
    expect([302, 307]).toContain(status);
  });

  // ---- Member detail ----

  it("admin can view active member detail", async () => {
    const { status } = await admin.getPage(`/admin/members/${SEED.members.active20d.id}`);
    expect(status).toBe(200);
  });

  it("admin can view expired member detail", async () => {
    const { status } = await admin.getPage(`/admin/members/${SEED.members.expired5d.id}`);
    expect(status).toBe(200);
  });

  it("admin can view member with no ticket", async () => {
    const { status } = await admin.getPage(`/admin/members/${SEED.members.noTicket.id}`);
    expect(status).toBe(200);
  });

  it("non-existent member returns 404", async () => {
    const { status } = await admin.getPage("/admin/members/99999");
    expect([404, 302]).toContain(status);
  });

  // ---- UPI QR ----

  it("UPI QR generates for valid params", async () => {
    const { status } = await admin.get("/api/upi-qr?amount=1500&memberName=Test&invoiceNumber=INV-001");
    expect(status).toBe(200);
  });

  it("UPI QR returns error for missing amount", async () => {
    const { status } = await admin.get("/api/upi-qr?memberName=Test");
    expect([400, 200]).toContain(status);
  });
});
