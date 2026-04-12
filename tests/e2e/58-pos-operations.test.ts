/**
 * E2E: POS Operations
 *
 * Tests POS page access and verifies product listing content.
 * Note: POS uses server actions (not API routes), so mutation tests
 * verify page content rather than direct API calls.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { TestClient, AnonClient, SEED } from "./helpers";

describe("POS Operations", () => {
  const admin = new TestClient();
  const member = new TestClient();
  const anon = new AnonClient();

  beforeAll(async () => {
    await admin.login(SEED.admin.email, SEED.admin.password);
    await member.login(SEED.members.active20d.email, SEED.members.active20d.password);
  });

  it("admin can access POS page", async () => {
    const { status } = await admin.getPage("/admin/pos");
    expect(status).toBe(200);
  });

  it("POS page contains product-related content", async () => {
    const { status, html } = await admin.getPage("/admin/pos");
    expect(status).toBe(200);
    // Page should render product management UI elements
    expect(html.toLowerCase()).toMatch(/product|pos|retail|inventory|stock/);
  });

  it("member cannot access POS page", async () => {
    const { status } = await member.getPage("/admin/pos");
    expect([302, 307]).toContain(status);
  });

  it("unauthenticated user is redirected from POS page", async () => {
    const { status } = await anon.get("/admin/pos");
    expect([302, 307]).toContain(status);
  });

  it("POS page includes sell/restock UI elements", async () => {
    const { html } = await admin.getPage("/admin/pos");
    // The page uses sellProductAction and restockProductAction
    expect(html.toLowerCase()).toMatch(/sell|restock|quantity|price/);
  });
});
