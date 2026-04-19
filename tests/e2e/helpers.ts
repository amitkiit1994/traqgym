/**
 * E2E Test Helpers
 *
 * Provides authenticated HTTP clients for each role (admin, staff, member)
 * and utility functions for the test suite.
 *
 * Requires: dev server running on BASE_URL (default http://localhost:3000)
 */

import { parse as parseCookie } from "cookie";

export const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:3000";

// Cookie jar per session
type CookieJar = Record<string, string>;

function cookieHeader(jar: CookieJar): string {
  return Object.entries(jar)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

function mergeCookies(jar: CookieJar, headers: Headers): void {
  const setCookies = headers.getSetCookie?.() || [];
  for (const raw of setCookies) {
    const parsed = parseCookie(raw);
    for (const [key, value] of Object.entries(parsed)) {
      // Skip cookie attributes
      if (
        [
          "path",
          "expires",
          "max-age",
          "domain",
          "samesite",
          "secure",
          "httponly",
        ].includes(key.toLowerCase())
      )
        continue;
      if (value !== undefined) jar[key] = value;
    }
  }
}

export class TestClient {
  private cookies: CookieJar = {};
  public email = "";
  public role = "";

  async login(email: string, password: string): Promise<{ ok: boolean; session: any }> {
    this.email = email;

    // 1. Get CSRF token
    const csrfRes = await fetch(`${BASE_URL}/api/auth/csrf`);
    mergeCookies(this.cookies, csrfRes.headers);
    const { csrfToken } = await csrfRes.json();

    // 2. Login via credentials callback
    const loginRes = await fetch(
      `${BASE_URL}/api/auth/callback/credentials`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Cookie: cookieHeader(this.cookies),
        },
        body: `csrfToken=${csrfToken}&email=${email}&password=${password}`,
        redirect: "manual",
      }
    );
    mergeCookies(this.cookies, loginRes.headers);

    // Follow redirects manually to collect cookies
    if (loginRes.status >= 300 && loginRes.status < 400) {
      const loc = loginRes.headers.get("location");
      if (loc) {
        const url = loc.startsWith("http") ? loc : `${BASE_URL}${loc}`;
        const redirectRes = await fetch(url, {
          headers: { Cookie: cookieHeader(this.cookies) },
          redirect: "manual",
        });
        mergeCookies(this.cookies, redirectRes.headers);
      }
    }

    // 3. Verify session
    const sessionRes = await fetch(`${BASE_URL}/api/auth/session`, {
      headers: { Cookie: cookieHeader(this.cookies) },
    });
    const session = await sessionRes.json();
    this.role = session?.user?.role || "";
    return { ok: !!session?.user, session };
  }

  async get(path: string): Promise<{ status: number; body: any; headers: Headers }> {
    const res = await fetch(`${BASE_URL}${path}`, {
      headers: { Cookie: cookieHeader(this.cookies) },
      redirect: "manual",
    });
    mergeCookies(this.cookies, res.headers);
    const contentType = res.headers.get("content-type") || "";
    let body: any;
    if (contentType.includes("json")) {
      body = await res.json();
    } else {
      body = await res.text();
    }
    return { status: res.status, body, headers: res.headers };
  }

  async post(path: string, data: any): Promise<{ status: number; body: any }> {
    const res = await fetch(`${BASE_URL}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookieHeader(this.cookies),
      },
      body: JSON.stringify(data),
      redirect: "manual",
    });
    mergeCookies(this.cookies, res.headers);
    const contentType = res.headers.get("content-type") || "";
    let body: any;
    if (contentType.includes("json")) {
      body = await res.json();
    } else {
      body = await res.text();
    }
    return { status: res.status, body };
  }

  async delete(path: string): Promise<{ status: number; body: any }> {
    const res = await fetch(`${BASE_URL}${path}`, {
      method: "DELETE",
      headers: { Cookie: cookieHeader(this.cookies) },
      redirect: "manual",
    });
    mergeCookies(this.cookies, res.headers);
    const ct = res.headers.get("content-type") || "";
    const body = ct.includes("json") ? await res.json() : await res.text();
    return { status: res.status, body };
  }

  async patch(path: string, data: any): Promise<{ status: number; body: any }> {
    const res = await fetch(`${BASE_URL}${path}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookieHeader(this.cookies),
      },
      body: JSON.stringify(data),
      redirect: "manual",
    });
    mergeCookies(this.cookies, res.headers);
    const ct = res.headers.get("content-type") || "";
    const body = ct.includes("json") ? await res.json() : await res.text();
    return { status: res.status, body };
  }

  /** POST that returns raw Response for streaming (SSE) */
  async postRaw(path: string, data: any): Promise<Response> {
    return fetch(`${BASE_URL}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookieHeader(this.cookies),
      },
      body: JSON.stringify(data),
    });
  }

  async getPage(path: string): Promise<{ status: number; html: string }> {
    const res = await fetch(`${BASE_URL}${path}`, {
      headers: { Cookie: cookieHeader(this.cookies) },
      redirect: "manual",
    });
    mergeCookies(this.cookies, res.headers);
    return { status: res.status, html: await res.text() };
  }
}

// Cron client — sends Authorization: Bearer ${CRON_SECRET} so the
// Sprint 8 requireCronSecret guard accepts the request. If CRON_SECRET is
// missing in the test env, requests skip the auth header and will get a 401
// (still useful for negative tests). Tests that need a real 200 from a cron
// route should call `CronClient.skipIfNoSecret()` to short-circuit when the
// env value isn't available locally.
export class CronClient {
  private readonly secret: string | undefined;
  constructor() {
    this.secret = process.env.CRON_SECRET;
  }
  isReady(): boolean {
    return Boolean(this.secret);
  }
  async get(path: string): Promise<{ status: number; body: any }> {
    const headers: Record<string, string> = {};
    if (this.secret) headers["Authorization"] = `Bearer ${this.secret}`;
    const res = await fetch(`${BASE_URL}${path}`, { headers, redirect: "manual" });
    const ct = res.headers.get("content-type") || "";
    const body = ct.includes("json") ? await res.json() : await res.text();
    return { status: res.status, body };
  }
  async post(path: string, data: any = {}): Promise<{ status: number; body: any }> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.secret) headers["Authorization"] = `Bearer ${this.secret}`;
    const res = await fetch(`${BASE_URL}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(data),
      redirect: "manual",
    });
    const ct = res.headers.get("content-type") || "";
    const body = ct.includes("json") ? await res.json() : await res.text();
    return { status: res.status, body };
  }
}

// Unauthenticated client (no cookies)
export class AnonClient {
  async get(path: string): Promise<{ status: number; body: any }> {
    const res = await fetch(`${BASE_URL}${path}`, { redirect: "manual" });
    const ct = res.headers.get("content-type") || "";
    const body = ct.includes("json") ? await res.json() : await res.text();
    return { status: res.status, body };
  }

  async post(path: string, data: any): Promise<{ status: number; body: any }> {
    const res = await fetch(`${BASE_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
      redirect: "manual",
    });
    const ct = res.headers.get("content-type") || "";
    const body = ct.includes("json") ? await res.json() : await res.text();
    return { status: res.status, body };
  }
}

// ---- Seed data constants (from prisma/seed.ts output) ----
export const SEED = {
  admin: { email: "admin@gym.com", password: "password123", id: 1 },
  staff: { email: "staff@gym.com", password: "password123", id: 2 },
  members: {
    active20d: { email: "member1@test.com", password: "password123", id: 1, phone: "9111111111", name: "Rahul Sharma" },
    expiring3d: { email: "member2@test.com", password: "password123", id: 2, phone: "9222222222", name: "Priya Patel" },
    expired5d: { email: "member3@test.com", password: "password123", id: 3, phone: "9333333333", name: "Amit Kumar" },
    activeAnnual: { email: "member4@test.com", password: "password123", id: 4, phone: "9444444444", name: "Sneha Reddy" },
    noTicket: { email: "member5@test.com", password: "password123", id: 5, phone: "9555555555", name: "Vikram Singh" },
  },
  locations: {
    main: { id: 1, name: "Main Branch", code: "MAIN" },
    cc: { id: 2, name: "City Center", code: "CC" },
  },
  plans: {
    monthly: { id: 1, name: "Monthly", price: 1500, days: 30 },
    quarterly: { id: 2, name: "Quarterly", price: 4000, days: 90 },
    annual: { id: 3, name: "Annual", price: 12000, days: 365 },
  },
  tickets: {
    member1: { id: 1, userId: 1, planId: 1 },
    member2: { id: 2, userId: 2, planId: 2 },
    member3: { id: 3, userId: 3, planId: 1 },
    member4: { id: 4, userId: 4, planId: 3 },
  },
  classes: {
    yoga: { id: 1, name: "Morning Yoga", capacity: 15 },
    zumba: { id: 2, name: "Evening Zumba", capacity: 20 },
  },
  promos: {
    welcome20: { code: "WELCOME20", discountType: "percentage", discountValue: 20 },
    summer10: { code: "SUMMER10", isActive: false },
  },
  enquiries: {
    new: { id: 1, name: "Ravi Verma", phone: "9666666666" },
    followUp: { id: 2, name: "Deepa Nair", phone: "9777777777" },
    converted: { id: 3, name: "Karan Mehta", phone: "9888888888" },
  },
  gracePeriodDays: 7,
} as const;
