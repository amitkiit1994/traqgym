/**
 * E2E: Comprehensive Cron + Biometric Endpoint Tests
 *
 * Covers all cron endpoints for response shape, HTTP status, and idempotency.
 *
 * Sprint 8 added requireCronSecret to all cron routes — they now require an
 * Authorization: Bearer ${CRON_SECRET} header. Anonymous and admin-cookie
 * requests both get 401 / 503 (depending on whether CRON_SECRET is set).
 * Tests use CronClient which sources the secret from .env.local.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { TestClient, AnonClient, CronClient, SEED } from "./helpers";

/* ------------------------------------------------------------------ */
/*  Cron endpoint definitions                                         */
/* ------------------------------------------------------------------ */

interface CronEndpoint {
  path: string;
  /** Fields that MUST exist in the JSON response (type checked) */
  requiredFields: Record<string, "number" | "boolean" | "string" | "any">;
  /** Some endpoints omit `success` (e.g. re-engagement) */
  hasSuccessFlag: boolean;
  /** Hits @openai/agents directly — 500 when OPENAI_API_KEY is missing. */
  needsOpenAi?: boolean;
}

const CRON_ENDPOINTS: CronEndpoint[] = [
  {
    path: "/api/cron/auto-checkout",
    requiredFields: { closed: "number" },
    hasSuccessFlag: true,
  },
  {
    path: "/api/cron/renewal-reminders",
    requiredFields: { sent: "number", skipped: "number", birthdaySent: "number" },
    hasSuccessFlag: true,
  },
  {
    path: "/api/cron/re-engagement",
    requiredFields: { sent: "number", skipped: "number" },
    hasSuccessFlag: false, // returns { sent, skipped } without success flag
  },
  {
    path: "/api/cron/ai-churn-alerts",
    requiredFields: {},
    hasSuccessFlag: true,
    needsOpenAi: true,
  },
  {
    path: "/api/cron/ai-daily-briefing",
    requiredFields: {},
    hasSuccessFlag: true,
    needsOpenAi: true,
  },
  {
    path: "/api/cron/ai-lead-followup",
    requiredFields: {},
    hasSuccessFlag: true,
  },
  {
    path: "/api/cron/ai-member-nudges",
    requiredFields: {},
    hasSuccessFlag: true,
  },
  {
    path: "/api/cron/ai-weekly-summary",
    requiredFields: {},
    hasSuccessFlag: true,
    needsOpenAi: true, // Monday guard short-circuits in UTC-Mon, falls through to runProactiveAgent
  },
  {
    path: "/api/cron/member-milestones",
    requiredFields: {},
    hasSuccessFlag: true,
  },
];

const HAS_OPENAI = Boolean(process.env.OPENAI_API_KEY);

/* ------------------------------------------------------------------ */
/*  Tests: Unauthenticated (AnonClient)                               */
/* ------------------------------------------------------------------ */

describe("Cron Endpoints — unauthenticated access is rejected (Sprint 8)", () => {
  const anon = new AnonClient();

  for (const ep of CRON_ENDPOINTS) {
    it(`GET ${ep.path} rejects anonymous caller`, async () => {
      const { status } = await anon.get(ep.path);
      // Sprint 8: requireCronSecret returns 401 (no header) or 503 (no env).
      // Both are valid — the invariant is "not 200 for anon callers".
      expect([401, 503]).toContain(status);
      expect(status).not.toBe(200);
    });
  }
});

/* ------------------------------------------------------------------ */
/*  Tests: Authenticated (admin TestClient)                           */
/* ------------------------------------------------------------------ */

describe("Cron Endpoints — Bearer-secret access (Sprint 8 cron auth)", () => {
  const cron = new CronClient();
  const skipAll = !cron.isReady();

  for (const ep of CRON_ENDPOINTS) {
    const skip = skipAll || (ep.needsOpenAi && !HAS_OPENAI);
    (skip ? it.skip : it)(`GET ${ep.path} returns 200 with valid shape`, async () => {
      const { status, body } = await cron.get(ep.path);
      expect(status).toBe(200);
      expect(typeof body).toBe("object");

      // success flag
      if (ep.hasSuccessFlag) {
        expect(body.success).toBe(true);
      }

      // If the endpoint was skipped (feature disabled / not Monday / etc.)
      // the response still has success:true but adds skipped:true + reason.
      // Use strict equality: some endpoints return a numeric `skipped` count field.
      if (body.skipped === true) {
        expect(typeof body.reason).toBe("string");
        return; // remaining field checks don't apply when skipped
      }

      // Required numeric/type fields
      for (const [field, expectedType] of Object.entries(ep.requiredFields)) {
        if (expectedType === "any") {
          expect(body).toHaveProperty(field);
        } else {
          expect(typeof body[field]).toBe(expectedType);
        }
      }
    });
  }
});

/* ------------------------------------------------------------------ */
/*  Tests: Individual cron response shape details                     */
/* ------------------------------------------------------------------ */

describe("Cron Endpoints — detailed response shapes", () => {
  const cron = new CronClient();
  const skip = !cron.isReady();
  const test = skip ? it.skip : it;

  test("auto-checkout: closed count is non-negative", async () => {
    const { body } = await cron.get("/api/cron/auto-checkout");
    if (!body.skipped) {
      expect(body.closed).toBeGreaterThanOrEqual(0);
    }
  });

  test("renewal-reminders: all count fields are non-negative", async () => {
    const { body } = await cron.get("/api/cron/renewal-reminders");
    // body.skipped can be boolean (endpoint skipped) or number (skipped count).
    // Only check count fields when endpoint was NOT skipped (skipped !== true).
    if (body.skipped === true) {
      expect(typeof body.reason).toBe("string");
    } else {
      expect(body.sent).toBeGreaterThanOrEqual(0);
      expect(body.birthdaySent).toBeGreaterThanOrEqual(0);
      expect(typeof body.aiRenewalSent).toBe("number");
    }
  });

  test("re-engagement: sent and skipped are non-negative", async () => {
    const { body } = await cron.get("/api/cron/re-engagement");
    if (!body.skipped) {
      expect(body.sent).toBeGreaterThanOrEqual(0);
      expect(body.skipped).toBeGreaterThanOrEqual(0);
    }
  });

  const aiTest = skip || !HAS_OPENAI ? it.skip : it;

  aiTest("ai-churn-alerts: returns atRisk count or skipped reason", async () => {
    const { body } = await cron.get("/api/cron/ai-churn-alerts");
    expect(body.success).toBe(true);
    if (body.skipped) {
      expect(typeof body.reason).toBe("string");
    } else {
      expect(typeof body.atRisk).toBe("number");
    }
  });

  aiTest("ai-daily-briefing: returns sent count or skipped reason", async () => {
    const { body } = await cron.get("/api/cron/ai-daily-briefing");
    expect(body.success).toBe(true);
    if (body.skipped) {
      expect(typeof body.reason).toBe("string");
    } else {
      expect(typeof body.sent).toBe("number");
      expect(typeof body.briefingLength).toBe("number");
    }
  });

  test("ai-lead-followup: returns processed or skipped reason", async () => {
    const { body } = await cron.get("/api/cron/ai-lead-followup");
    expect(body.success).toBe(true);
    if (body.skipped === true) {
      // Endpoint disabled via settings
      expect(typeof body.reason).toBe("string");
    } else {
      // Route always returns processed; sent/skipped only present when leads were found
      expect(typeof body.processed).toBe("number");
      if (body.processed > 0) {
        expect(typeof body.sent).toBe("number");
        expect(typeof body.skipped).toBe("number");
      }
    }
  });

  test("ai-member-nudges: returns eligible/sent or skipped reason", async () => {
    const { body } = await cron.get("/api/cron/ai-member-nudges");
    expect(body.success).toBe(true);
    if (body.skipped) {
      expect(typeof body.reason).toBe("string");
    } else {
      expect(typeof body.eligible).toBe("number");
      expect(typeof body.sent).toBe("number");
    }
  });

  aiTest("ai-weekly-summary: returns adminsNotified or skipped reason", async () => {
    const { body } = await cron.get("/api/cron/ai-weekly-summary");
    expect(body.success).toBe(true);
    if (body.skipped) {
      expect(typeof body.reason).toBe("string");
    } else {
      expect(typeof body.adminsNotified).toBe("number");
    }
  });

  test("member-milestones: returns milestones count or skipped reason", async () => {
    const { body } = await cron.get("/api/cron/member-milestones");
    expect(body.success).toBe(true);
    if (body.skipped === true) {
      expect(typeof body.reason).toBe("string");
    } else {
      // Route always returns milestones count; sent only present when milestones > 0
      expect(typeof body.milestones).toBe("number");
      if (body.milestones > 0) {
        expect(typeof body.sent).toBe("number");
      }
    }
  });
});

/* ------------------------------------------------------------------ */
/*  Tests: Idempotency (re-running should not fail)                   */
/* ------------------------------------------------------------------ */

describe("Cron Endpoints — idempotency", () => {
  const cron = new CronClient();
  const skip = !cron.isReady();
  const test = skip ? it.skip : it;

  test("auto-checkout is safe to call twice", async () => {
    const first = await cron.get("/api/cron/auto-checkout");
    const second = await cron.get("/api/cron/auto-checkout");
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
  });

  test("renewal-reminders second run skips already-sent", async () => {
    const first = await cron.get("/api/cron/renewal-reminders");
    const second = await cron.get("/api/cron/renewal-reminders");
    expect(second.status).toBe(200);
    if (!first.body.skipped && !second.body.skipped) {
      expect(second.body.skipped).toBeGreaterThanOrEqual(first.body.sent);
    }
  });

  test("re-engagement second run skips already-sent", async () => {
    const first = await cron.get("/api/cron/re-engagement");
    const second = await cron.get("/api/cron/re-engagement");
    expect(second.status).toBe(200);
    if (!first.body.skipped && !second.body.skipped) {
      expect(second.body.skipped).toBeGreaterThanOrEqual(first.body.sent);
    }
  });

  test("member-milestones is safe to call twice", async () => {
    const first = await cron.get("/api/cron/member-milestones");
    const second = await cron.get("/api/cron/member-milestones");
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
  });
});

/* ------------------------------------------------------------------ */
/*  Biometric API routes                                              */
/* ------------------------------------------------------------------ */

describe("Biometric API routes", () => {
  const admin = new TestClient();

  beforeAll(async () => {
    const { ok } = await admin.login(SEED.admin.email, SEED.admin.password);
    expect(ok).toBe(true);
  });

  // These routes do not exist yet. Tests document the expected endpoints
  // and will start passing once the biometric module is implemented.

  it.skip("GET /api/biometric/devices returns device list", async () => {
    const { status, body } = await admin.get("/api/biometric/devices");
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
  });

  it.skip("GET /api/biometric/sync-runs returns sync history", async () => {
    const { status, body } = await admin.get("/api/biometric/sync-runs");
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
  });

  it.skip("GET /api/biometric/unmatched returns unmatched records", async () => {
    const { status, body } = await admin.get("/api/biometric/unmatched");
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
  });
});
