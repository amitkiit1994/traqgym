/**
 * E2E: API Gaps — additional coverage for health, gym-brand, locations,
 * people, invoice PDF, settings, and UPI QR endpoints.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { TestClient, AnonClient, SEED } from "./helpers";

describe("API Gaps", () => {
  const admin = new TestClient();
  const staff = new TestClient();
  const member = new TestClient();
  const anon = new AnonClient();

  beforeAll(async () => {
    await admin.login(SEED.admin.email, SEED.admin.password);
    await staff.login(SEED.staff.email, SEED.staff.password);
    await member.login(
      SEED.members.active20d.email,
      SEED.members.active20d.password,
    );
  });

  // ---- Health Check ----

  describe("Health Check", () => {
    it("GET /api/health returns 200 with status ok", async () => {
      const { status, body } = await anon.get("/api/health");
      expect(status).toBe(200);
      expect(body.status).toBe("ok");
      expect(body.timestamp).toBeTruthy();
    });

    it("timestamp is a valid ISO string", async () => {
      const { body } = await anon.get("/api/health");
      const parsed = new Date(body.timestamp);
      expect(parsed.getTime()).not.toBeNaN();
    });
  });

  // ---- Gym Brand ----

  describe("Gym Brand", () => {
    it("GET /api/gym-brand returns gym name and logo fields", async () => {
      const { status, body } = await anon.get("/api/gym-brand");
      expect(status).toBe(200);
      expect(typeof body.name).toBe("string");
      expect(body.name.length).toBeGreaterThan(0);
      expect("logo" in body).toBe(true);
    });

    it("gym-brand is publicly accessible (no auth needed)", async () => {
      const { status } = await anon.get("/api/gym-brand");
      expect(status).toBe(200);
    });
  });

  // ---- Locations ----

  describe("Locations", () => {
    it("authenticated user gets array of active locations", async () => {
      const { status, body } = await admin.get("/api/locations");
      expect(status).toBe(200);
      expect(Array.isArray(body)).toBe(true);
      expect(body.length).toBeGreaterThanOrEqual(2);
    });

    it("each location has id, name, and code", async () => {
      const { body } = await admin.get("/api/locations");
      for (const loc of body) {
        expect(loc.id).toBeDefined();
        expect(typeof loc.name).toBe("string");
        expect(typeof loc.code).toBe("string");
      }
    });

    it("seed locations are present", async () => {
      const { body } = await admin.get("/api/locations");
      const names = body.map((l: any) => l.name);
      expect(names).toContain(SEED.locations.main.name);
      expect(names).toContain(SEED.locations.cc.name);
    });

    it("unauthenticated request returns 401", async () => {
      const { status } = await anon.get("/api/locations");
      expect([401, 302]).toContain(status);
    });

    it("member can list locations", async () => {
      const { status, body } = await member.get("/api/locations");
      expect(status).toBe(200);
      expect(Array.isArray(body)).toBe(true);
    });
  });

  // ---- People ----

  describe("People", () => {
    it("admin gets list of people (members + staff)", async () => {
      const { status, body } = await admin.get("/api/people");
      expect(status).toBe(200);
      expect(Array.isArray(body)).toBe(true);
      expect(body.length).toBeGreaterThan(0);
    });

    it("each person has id, name, and type", async () => {
      const { body } = await admin.get("/api/people");
      for (const person of body) {
        expect(person.id).toBeDefined();
        expect(typeof person.name).toBe("string");
        expect(["member", "staff"]).toContain(person.type);
      }
    });

    it("includes known seed member (Rahul Sharma)", async () => {
      const { body } = await admin.get("/api/people");
      const names = body.map((p: any) => p.name);
      expect(names).toContain("Rahul Sharma");
    });

    it("staff can list people", async () => {
      const { status, body } = await staff.get("/api/people");
      expect(status).toBe(200);
      expect(Array.isArray(body)).toBe(true);
    });

    it("member cannot list people (workers only)", async () => {
      const { status } = await member.get("/api/people");
      expect(status).toBe(401);
    });

    it("anon cannot list people", async () => {
      const { status } = await anon.get("/api/people");
      expect([401, 302]).toContain(status);
    });
  });

  // ---- Invoice PDF ----

  describe("Invoice PDF", () => {
    it("returns HTML invoice for valid ID (seed invoice 1)", async () => {
      const { status, body, headers } = await admin.get("/api/invoices/1/pdf");
      // Invoice 1 may or may not exist depending on seed; accept 200 or 404
      if (status === 200) {
        expect(typeof body).toBe("string");
        expect(body).toContain("invoice");
      } else {
        expect(status).toBe(404);
      }
    });

    it("returns 404 for non-existent invoice", async () => {
      const { status, body } = await admin.get("/api/invoices/99999/pdf");
      expect(status).toBe(404);
      expect(body.error).toBe("Invoice not found");
    });

    it("returns 400 for non-numeric invoice ID", async () => {
      const { status, body } = await admin.get("/api/invoices/abc/pdf");
      expect(status).toBe(400);
      expect(body.error).toBe("Invalid invoice ID");
    });

    it("invoice PDF is accessible without auth (public link)", async () => {
      // The route does not check auth — it's a shareable invoice link
      const { status } = await anon.get("/api/invoices/99999/pdf");
      // Should get 404 (not 401) since there's no auth check
      expect(status).toBe(404);
    });
  });

  // ---- Admin Settings ----

  describe("Admin Settings", () => {
    it("admin GET returns all setting keys", async () => {
      const { status, body } = await admin.get("/api/admin/settings");
      expect(status).toBe(200);
      // Spot-check a selection of expected keys
      expect(body.gym_name).toBeDefined();
      expect(body.gym_state).toBeDefined();
      expect(body.grace_period_days).toBeDefined();
      expect(body.auto_checkout_enabled).toBeDefined();
      expect(body.notification_channel).toBeDefined();
      expect(body.payment_modes).toBeDefined();
    });

    it("admin can update a setting and read it back", async () => {
      const unique = `TestGym_${Date.now()}`;
      const { status } = await admin.post("/api/admin/settings", {
        gym_name: unique,
      });
      expect(status).toBe(200);

      const { body } = await admin.get("/api/admin/settings");
      expect(body.gym_name).toBe(unique);
    });

    it("POST with unknown keys is ignored (no error)", async () => {
      const { status, body } = await admin.post("/api/admin/settings", {
        nonexistent_key: "whatever",
      });
      expect(status).toBe(200);
      expect(body.success).toBe(true);
    });

    it("staff can GET settings (worker actorType)", async () => {
      const { status, body } = await staff.get("/api/admin/settings");
      expect(status).toBe(200);
      expect(body.gym_name).toBeDefined();
    });

    it("staff cannot POST settings (admin role required)", async () => {
      const { status } = await staff.post("/api/admin/settings", {
        grace_period_days: "99",
      });
      expect(status).toBe(401);
    });

    it("member cannot GET settings", async () => {
      const { status } = await member.get("/api/admin/settings");
      expect(status).toBe(401);
    });

    it("member cannot POST settings", async () => {
      const { status } = await member.post("/api/admin/settings", {
        gym_name: "Hacked",
      });
      expect(status).toBe(401);
    });

    it("anon cannot GET settings", async () => {
      const { status } = await anon.get("/api/admin/settings");
      expect(status).toBe(401);
    });

    it("anon cannot POST settings", async () => {
      const { status } = await anon.post("/api/admin/settings", {
        gym_name: "Hacked",
      });
      expect(status).toBe(401);
    });
  });

  // ---- UPI QR ----

  describe("UPI QR", () => {
    // UPI QR generation requires gym_upi_vpa to be configured in gym settings
    // or GYM_UPI_VPA env var. In test environments this is typically not set,
    // causing a 500 error from generateUpiUrl.
    it.skip("returns SVG with valid amount and memberName", async () => {
      const { status, body } = await anon.get(
        "/api/upi-qr?amount=1500&memberName=Rahul%20Sharma",
      );
      expect(status).toBe(200);
      expect(typeof body).toBe("string");
      expect(body).toContain("<svg");
    });

    it.skip("accepts optional invoiceNumber param", async () => {
      const { status, body } = await anon.get(
        "/api/upi-qr?amount=1500&memberName=TestUser&invoiceNumber=INV-001",
      );
      expect(status).toBe(200);
      expect(body).toContain("<svg");
    });

    it("400 when amount is missing", async () => {
      const { status, body } = await anon.get(
        "/api/upi-qr?memberName=TestUser",
      );
      expect(status).toBe(400);
      expect(body.error).toContain("required");
    });

    it("400 when memberName is missing", async () => {
      const { status, body } = await anon.get("/api/upi-qr?amount=1500");
      expect(status).toBe(400);
      expect(body.error).toContain("required");
    });

    it("400 for zero amount", async () => {
      const { status } = await anon.get(
        "/api/upi-qr?amount=0&memberName=TestUser",
      );
      expect(status).toBe(400);
    });

    it("400 for negative amount", async () => {
      const { status } = await anon.get(
        "/api/upi-qr?amount=-500&memberName=TestUser",
      );
      expect(status).toBe(400);
    });

    it("400 for non-numeric amount", async () => {
      const { status } = await anon.get(
        "/api/upi-qr?amount=abc&memberName=TestUser",
      );
      expect(status).toBe(400);
    });

    it("400 when both params are missing", async () => {
      const { status } = await anon.get("/api/upi-qr");
      expect(status).toBe(400);
    });
  });
});
