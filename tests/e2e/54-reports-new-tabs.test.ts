/**
 * E2E: New report tabs (P&L, Membership Matrix, Source Analysis, Login History)
 * Verifies that the reports page loads successfully for admin.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { TestClient, SEED } from "./helpers";

describe("Reports — New Tabs", () => {
  const admin = new TestClient();

  beforeAll(async () => {
    await admin.login(SEED.admin.email, SEED.admin.password);
  });

  it("reports page loads without error", async () => {
    const { status } = await admin.getPage("/admin/reports");
    expect(status).toBe(200);
  });

  it("page includes P&L tab trigger", async () => {
    const { status, html } = await admin.getPage("/admin/reports");
    expect(status).toBe(200);
    expect(html).toContain("P&amp;L Report");
  });

  it("page includes Membership Matrix tab trigger", async () => {
    const { status, html } = await admin.getPage("/admin/reports");
    expect(status).toBe(200);
    expect(html).toContain("Membership Matrix");
  });

  it("page includes Source Analysis tab trigger", async () => {
    const { status, html } = await admin.getPage("/admin/reports");
    expect(status).toBe(200);
    expect(html).toContain("Source Analysis");
  });

  it("page includes Login History tab trigger", async () => {
    const { status, html } = await admin.getPage("/admin/reports");
    expect(status).toBe(200);
    expect(html).toContain("Login History");
  });
});
