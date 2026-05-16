# Phase 5: Security & Ops Basics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**Goal:** Close the top security/ops gaps found in audit. Scoped to demo-critical items. (5d telegram-pair-length, 5e Sentry, 5f restore.sh deferred to a follow-up phase to keep context manageable.)

**In-scope:**
- 5a `/api/people` cross-tenant leak fix
- 5b `/api/upi-qr` add auth
- 5b `/api/admin/logo` path-traversal fix
- 5c NextAuth fail-fast secret guard
- 5g `lib/services/notification.ts` wired with MSG91 + SMTP

**Source spec:** `docs/specs/2026-05-16-path-to-prod-design.md` Phase 5.

---

### Task 1: Fix `/api/people` cross-tenant leak

**Problem:** Returns ALL users + ALL workers to any logged-in worker (admin or staff). Staff at branch A can see members at branch B.

**Files:**
- Modify: `app/api/people/route.ts`

- [ ] **Step 1: Replace file contents:**

```typescript
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

const MAX_RESULTS = 500;

export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.actorType !== "worker") {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const role = (session.user as { role?: string }).role;
  const locationId = (session.user as { locationId?: number | null }).locationId ?? null;

  // Admins see everyone. Staff/trainer scoped to their location.
  const userWhere: { locationId?: number } = {};
  const workerWhere: { isActive: boolean; locationId?: number } = { isActive: true };

  if (role !== "admin") {
    if (locationId == null) {
      // Non-admin worker without a location can't see anyone (safe default).
      return Response.json([]);
    }
    userWhere.locationId = locationId;
    workerWhere.locationId = locationId;
  }

  const [users, workers] = await Promise.all([
    prisma.user.findMany({
      where: userWhere,
      select: { id: true, firstname: true, lastname: true },
      orderBy: { firstname: "asc" },
      take: MAX_RESULTS,
    }),
    prisma.worker.findMany({
      where: workerWhere,
      select: { id: true, firstname: true, lastname: true },
      orderBy: { firstname: "asc" },
      take: MAX_RESULTS,
    }),
  ]);

  return Response.json([
    ...users.map((u) => ({ id: u.id, name: `${u.firstname} ${u.lastname}`, type: "member" as const })),
    ...workers.map((w) => ({ id: w.id, name: `${w.firstname} ${w.lastname}`, type: "staff" as const })),
  ]);
}
```

- [ ] **Step 2: Type check, commit**

```bash
cd /Users/amitkumardas/freeformOS/freeformfitnessOS
npx tsc --noEmit 2>&1 | grep "api/people" | head -5
# Expected: empty (no errors in this file)
git add app/api/people/route.ts
git commit -m "fix(security): scope /api/people to caller's location for non-admins

Previously returned ALL members and staff to any logged-in worker, leaking
cross-location data to staff/trainers. Now:
- Admin role: unchanged (sees everyone)
- Other workers: scoped to session.user.locationId
- Workers with no location: return empty (safe default)
- Capped at 500 results to prevent unbounded payload

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 2: Fix `/api/upi-qr` — require auth + scope

**Problem:** Anyone (no auth) can generate UPI QR for any amount targeted at the gym's VPA, with any member name. Enables invoice fraud — attacker generates a legit-looking QR with their own name+amount, gives to a third party who pays them.

**Files:**
- Modify: `app/api/upi-qr/route.ts`

- [ ] **Step 1: Replace file contents:**

```typescript
import QRCode from "qrcode";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { generateUpiUrl } from "@/lib/services/upi-qr";

export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const amount = searchParams.get("amount");
  const memberName = searchParams.get("memberName");
  const invoiceNumber = searchParams.get("invoiceNumber") ?? "PENDING";
  const memberIdRaw = searchParams.get("memberId");

  if (!amount || !memberName) {
    return Response.json({ error: "amount and memberName are required" }, { status: 400 });
  }

  const parsedAmount = parseFloat(amount);
  if (isNaN(parsedAmount) || parsedAmount <= 0 || parsedAmount > 1_000_000) {
    return Response.json({ error: "Invalid amount (must be > 0 and < 10,00,000)" }, { status: 400 });
  }

  // Scope by actor:
  //   - Member: can only generate QR for themselves
  //   - Worker: can generate for any member at their location (admin = anywhere)
  const actorType = (session.user as { actorType?: string }).actorType;
  if (actorType === "member") {
    const memberId = memberIdRaw ? parseInt(memberIdRaw, 10) : null;
    const sessionUserId = (session.user as { id?: number }).id ?? null;
    if (!memberId || memberId !== sessionUserId) {
      return Response.json(
        { error: "Members can only generate QR for their own account" },
        { status: 403 }
      );
    }
  } else if (actorType === "worker") {
    const role = (session.user as { role?: string }).role;
    const callerLocationId = (session.user as { locationId?: number | null }).locationId ?? null;
    const memberId = memberIdRaw ? parseInt(memberIdRaw, 10) : null;
    if (memberId && role !== "admin") {
      // Ensure target member is at caller's location
      const member = await prisma.user.findUnique({
        where: { id: memberId },
        select: { locationId: true },
      });
      if (!member || member.locationId !== callerLocationId) {
        return Response.json(
          { error: "Member not in your location" },
          { status: 403 }
        );
      }
    }
  } else {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const upiUrl = await generateUpiUrl({
      amount: parsedAmount,
      memberName,
      invoiceNumber,
    });
    const svg = await QRCode.toString(upiUrl, { type: "svg", margin: 2 });
    return new Response(svg, {
      headers: {
        "Content-Type": "image/svg+xml",
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
```

- [ ] **Step 2: Type check, commit**

```bash
cd /Users/amitkumardas/freeformOS/freeformfitnessOS
npx tsc --noEmit 2>&1 | grep "upi-qr" | head -5
git add app/api/upi-qr/route.ts
git commit -m "fix(security): require auth on /api/upi-qr + scope to caller

Previously unauthenticated and accepted arbitrary amount + memberName,
allowing invoice fraud (anyone could generate a legit-looking UPI QR
pointing at the gym's VPA for any amount).

Now:
- Requires session
- Members: can only generate for their own memberId
- Workers (non-admin): can only generate for members at their location
- Admins: unrestricted (within gym)
- Amount capped at 10,00,000 to bound abuse

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 3: Fix `/api/admin/logo` path traversal + extension injection

**Problem:** Uses `file.name.split(".").pop()` as extension and writes `gym-logo.${ext}` to `public/uploads/`. Attacker uploads file named `evil.php` with MIME image/png → writes `gym-logo.php` → served as PHP if reverse proxy misconfigured.

**Files:**
- Modify: `app/api/admin/logo/route.ts`

- [ ] **Step 1: Replace file contents:**

```typescript
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { setSetting } from "@/lib/services/settings";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const MAX_SIZE = 2 * 1024 * 1024; // 2MB

// MIME → file extension map. Extension is derived from MIME, not user-supplied name.
const ALLOWED: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/svg+xml": "svg",
  "image/webp": "webp",
};

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (
    !session ||
    (session.user as { actorType?: string }).actorType !== "worker" ||
    (session.user as { role?: string }).role !== "admin"
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await req.formData();
  const file = formData.get("logo");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  const ext = ALLOWED[file.type];
  if (!ext) {
    return NextResponse.json(
      { error: "Invalid file type. Use PNG, JPEG, SVG, or WebP." },
      { status: 400 }
    );
  }

  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: "File too large. Maximum 2MB." }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: "File is empty." }, { status: 400 });
  }

  // Filename is a fresh random hex + the MIME-derived extension.
  // Never trust file.name.
  const filename = `gym-logo-${crypto.randomBytes(8).toString("hex")}.${ext}`;
  const uploadDir = path.join(process.cwd(), "public", "uploads");
  const uploadPath = path.join(uploadDir, filename);

  // Defence-in-depth: confirm the resolved path is still inside uploadDir.
  const resolvedDir = path.resolve(uploadDir);
  const resolvedPath = path.resolve(uploadPath);
  if (!resolvedPath.startsWith(resolvedDir + path.sep)) {
    return NextResponse.json({ error: "Invalid upload path" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(uploadPath, buffer);
  await setSetting("gym_logo", `/uploads/${filename}`);

  return NextResponse.json({ success: true, path: `/uploads/${filename}` });
}
```

- [ ] **Step 2: Type check, commit**

```bash
cd /Users/amitkumardas/freeformOS/freeformfitnessOS
npx tsc --noEmit 2>&1 | grep "admin/logo" | head -5
git add app/api/admin/logo/route.ts
git commit -m "fix(security): harden logo upload — MIME-derived ext + randomised filename

Previously:
- Extension came from user-supplied file.name (split('.').pop()) — attacker
  could upload evil.php with MIME image/png to write gym-logo.php
- Reused fixed filename gym-logo.<ext> — old logo could be probed/cached

Now:
- Extension whitelist mapped FROM the MIME type (image/png -> .png etc.)
- Filename randomised (gym-logo-<16hex>.<ext>)
- Path resolved + validated to be inside uploads dir
- Zero-byte uploads rejected

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 4: NextAuth fail-fast secret guard

**Problem:** No production-time check that `NEXTAUTH_SECRET` is set OR not the `.env.example` placeholder. Silent fallback to autogenerated dev secret breaks JWT signing in unpredictable ways.

**Files:**
- Modify: `lib/auth.ts` (only the top of file — add the guard, don't change auth flow)

- [ ] **Step 1: Read the current top of `lib/auth.ts`**

```bash
cd /Users/amitkumardas/freeformOS/freeformfitnessOS
head -30 lib/auth.ts
```

- [ ] **Step 2: Add guard at top of file**

Use the Edit tool to ADD a `process.env.NEXTAUTH_SECRET` check immediately after the imports (and before the `authOptions` constant). The new block:

```typescript
// Fail-fast: refuse to boot in production if NEXTAUTH_SECRET is missing or
// is the .env.example placeholder. A weak/missing secret means JWTs are
// signable by anyone with the source code.
if (process.env.NODE_ENV === "production") {
  const secret = process.env.NEXTAUTH_SECRET ?? "";
  if (!secret) {
    throw new Error(
      "NEXTAUTH_SECRET is required in production. Generate one with `openssl rand -base64 32` and set it in your Vercel project's env vars."
    );
  }
  if (secret.toLowerCase().includes("change-me") || secret.length < 32) {
    throw new Error(
      "NEXTAUTH_SECRET appears to be the .env.example placeholder or too short. Generate a real secret with `openssl rand -base64 32`."
    );
  }
}
```

Insert it AFTER all import statements and BEFORE the first non-import declaration (typically `export const authOptions = {...}` or similar).

- [ ] **Step 3: Type check, commit**

```bash
cd /Users/amitkumardas/freeformOS/freeformfitnessOS
npx tsc --noEmit 2>&1 | grep "auth.ts" | head -5
git add lib/auth.ts
git commit -m "fix(security): fail-fast guard for NEXTAUTH_SECRET in production

Refuses to boot if:
  - NEXTAUTH_SECRET is unset, OR
  - NEXTAUTH_SECRET contains 'change-me' (the .env.example placeholder), OR
  - NEXTAUTH_SECRET is < 32 chars (too weak)

Dev/test unaffected. Production gym deployments must set a real secret
or the app exits at boot with a clear error.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 5: Wire notification service

**Files:**
- Create: `lib/services/notification.ts`
- Create: `tests/unit/notification.test.ts`

- [ ] **Step 1: Failing test** — create `tests/unit/notification.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/services/settings", () => {
  const store = new Map<string, string>();
  return {
    getSetting: vi.fn((key: string, def: string) => Promise.resolve(store.get(key) ?? def)),
    setSetting: vi.fn((key: string, value: string) => {
      store.set(key, value);
      return Promise.resolve();
    }),
    listEncryptedKeys: vi.fn(() => []),
  };
});

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

describe("notification service", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.resetModules();
  });

  it("sendSMS calls MSG91 with configured auth key", async () => {
    const { setSetting } = await import("@/lib/services/settings");
    await setSetting("msg91_auth_key", "test-key");
    await setSetting("msg91_sender_id", "FFFGYM");
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ type: "success" }) } as Response);

    const { sendSMS } = await import("@/lib/services/notification");
    const res = await sendSMS({ to: "9819811652", message: "Test" });
    expect(res.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0];
    expect(call[0]).toContain("msg91.com");
  });

  it("sendSMS returns success=false (graceful) when MSG91 not configured", async () => {
    const { sendSMS } = await import("@/lib/services/notification");
    const res = await sendSMS({ to: "9819811652", message: "Test" });
    expect(res.success).toBe(false);
    expect(res.skipped).toBe(true); // skipped, not errored
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sendEmail returns skipped when SMTP not configured", async () => {
    const { sendEmail } = await import("@/lib/services/notification");
    const res = await sendEmail({ to: "test@test.com", subject: "x", body: "x" });
    expect(res.success).toBe(false);
    expect(res.skipped).toBe(true);
  });

  it("normalizePhone strips +91 prefix and validates length", async () => {
    const { normalizePhone } = await import("@/lib/services/notification");
    expect(normalizePhone("9819811652")).toBe("9819811652");
    expect(normalizePhone("+919819811652")).toBe("9819811652");
    expect(normalizePhone("91 98198 11652")).toBe("9819811652");
    expect(normalizePhone("12345")).toBe(null); // too short
    expect(normalizePhone("")).toBe(null);
  });
});
```

- [ ] **Step 2: Test fails (file doesn't exist)**

```bash
cd /Users/amitkumardas/freeformOS/freeformfitnessOS
DATA_ENCRYPTION_KEY=$(openssl rand -base64 32) NEXTAUTH_SECRET=test npx vitest run tests/unit/notification.test.ts --config=vitest.unit.config.ts 2>&1 | tail -10
```

- [ ] **Step 3: Implement `lib/services/notification.ts`**

Create `lib/services/notification.ts`:

```typescript
import { getSetting } from "@/lib/services/settings";
import nodemailer from "nodemailer";

/**
 * Unified notification surface — SMS, email, WhatsApp.
 * Each channel returns `{ success, skipped?, error? }`:
 *   - success=true: sent
 *   - success=false, skipped=true: channel not configured (graceful no-op)
 *   - success=false, skipped=false: actual failure, see `error`
 *
 * Callers should treat skipped as informational (log a debug line) and
 * actual failures as warnings (log + maybe retry).
 */

export type SendResult = {
  success: boolean;
  skipped?: boolean;
  error?: string;
};

/**
 * Normalises an Indian mobile to bare 10 digits. Returns null if invalid.
 * Accepts:
 *   9819811652
 *   +919819811652
 *   91 98198 11652
 *   919819811652
 */
export function normalizePhone(raw: string): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return digits;
  if (digits.length === 12 && digits.startsWith("91")) return digits.slice(2);
  return null;
}

// ─── SMS via MSG91 ──────────────────────────────────────────────────────────

export async function sendSMS(params: { to: string; message: string }): Promise<SendResult> {
  const authKey = await getSetting("msg91_auth_key", "");
  const senderId = await getSetting("msg91_sender_id", "FFFGYM");
  if (!authKey) {
    return { success: false, skipped: true, error: "MSG91 not configured (msg91_auth_key missing)" };
  }
  const phone = normalizePhone(params.to);
  if (!phone) {
    return { success: false, error: `Invalid phone number: ${params.to}` };
  }

  try {
    const res = await fetch("https://api.msg91.com/api/v5/flow/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        authkey: authKey,
      },
      body: JSON.stringify({
        sender: senderId,
        short_url: "0",
        mobiles: `91${phone}`,
        message: params.message,
      }),
    });
    const json = (await res.json()) as { type?: string; message?: string };
    if (!res.ok || json.type !== "success") {
      return { success: false, error: json.message ?? `MSG91 returned HTTP ${res.status}` };
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Network error" };
  }
}

// ─── Email via SMTP (nodemailer) ────────────────────────────────────────────

export async function sendEmail(params: {
  to: string;
  subject: string;
  body: string;
  html?: string;
}): Promise<SendResult> {
  const host = await getSetting("smtp_host", process.env.SMTP_HOST ?? "");
  const port = parseInt(await getSetting("smtp_port", process.env.SMTP_PORT ?? "587"), 10);
  const user = await getSetting("smtp_user", process.env.SMTP_USER ?? "");
  const pass = await getSetting("smtp_pass", process.env.SMTP_PASS ?? "");
  const from = await getSetting("smtp_from", process.env.SMTP_FROM ?? user);

  if (!host || !user || !pass) {
    return { success: false, skipped: true, error: "SMTP not configured" };
  }

  try {
    const transport = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
    });
    await transport.sendMail({
      from,
      to: params.to,
      subject: params.subject,
      text: params.body,
      html: params.html,
    });
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "SMTP send failed" };
  }
}

// ─── WhatsApp via MSG91 ─────────────────────────────────────────────────────

export async function sendWhatsApp(params: {
  to: string;
  templateName: string;
  templateData?: Record<string, string>;
}): Promise<SendResult> {
  const authKey = await getSetting("msg91_auth_key", "");
  const waNumber = await getSetting("msg91_whatsapp_number", "");
  if (!authKey || !waNumber) {
    return { success: false, skipped: true, error: "MSG91 WhatsApp not configured" };
  }
  const phone = normalizePhone(params.to);
  if (!phone) {
    return { success: false, error: `Invalid phone: ${params.to}` };
  }
  try {
    const res = await fetch("https://api.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/", {
      method: "POST",
      headers: { "Content-Type": "application/json", authkey: authKey },
      body: JSON.stringify({
        integrated_number: waNumber,
        content_type: "template",
        payload: {
          to: `91${phone}`,
          type: "template",
          template: {
            name: params.templateName,
            language: { code: "en", policy: "deterministic" },
            ...(params.templateData
              ? { components: [{ type: "body", parameters: Object.values(params.templateData).map((v) => ({ type: "text", text: v })) }] }
              : {}),
          },
        },
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { success: false, error: `WhatsApp HTTP ${res.status}: ${text}` };
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "WhatsApp send failed" };
  }
}
```

- [ ] **Step 4: Tests pass**

```bash
cd /Users/amitkumardas/freeformOS/freeformfitnessOS
DATA_ENCRYPTION_KEY=$(openssl rand -base64 32) NEXTAUTH_SECRET=test npx vitest run tests/unit/notification.test.ts --config=vitest.unit.config.ts 2>&1 | tail -10
```
Expected: 4/4 pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/amitkumardas/freeformOS/freeformfitnessOS
git add lib/services/notification.ts tests/unit/notification.test.ts
git commit -m "$(cat <<'EOF'
feat(notification): unified SMS/email/WhatsApp service

lib/services/notification.ts:
  - sendSMS via MSG91 Flow API
  - sendEmail via nodemailer + SMTP
  - sendWhatsApp via MSG91 WhatsApp Outbound
  - normalizePhone helper (India: bare-10-digit canonical form)

Each function returns {success, skipped?, error?}:
  - skipped=true means the channel isn't configured (graceful no-op)
  - !success means actual failure (caller logs/retries)

Now callers (renewal reminders, manager briefings, etc.) can call these
instead of logging "TODO send notification" lines.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Final verification

- [ ] **Step 1: All unit tests**

```bash
cd /Users/amitkumardas/freeformOS/freeformfitnessOS
DATA_ENCRYPTION_KEY=$(openssl rand -base64 32) NEXTAUTH_SECRET=test NEXTAUTH_URL=https://x.com npx vitest run tests/unit/ --config=vitest.unit.config.ts 2>&1 | tail -10
```
Expected: 20/20 + 3 pre-existing ux-component failures.

- [ ] **Step 2: tsc**

```bash
cd /Users/amitkumardas/freeformOS/freeformfitnessOS
npx tsc --noEmit 2>&1 | wc -l
```
Expected: same baseline (no new errors).

- [ ] **Step 3: Git log**

```bash
cd /Users/amitkumardas/freeformOS/freeformfitnessOS
git log --oneline -10
```
Expected: 5 new commits on top of Phase 3c.

## Done criteria

- [ ] `/api/people` scoped to location for non-admins
- [ ] `/api/upi-qr` requires auth + scoped
- [ ] `/api/admin/logo` hardened (MIME ext, random filename, path validation)
- [ ] NextAuth fail-fast guard in `lib/auth.ts`
- [ ] `lib/services/notification.ts` wired
- [ ] 5 commits on main

## Deferred to a follow-up phase

- 5d Telegram pair code length + rate limit
- 5e Sentry integration
- 5f restore.sh + ops docs
- CSRF Origin/Host check across all `/api/admin/*` POST (significant scope — would touch many routes)
- Rate limiting middleware (`lib/services/ratelimit.ts`)

## Next phase trigger

Phase 5 done → Phase 6 (Onboarding/UX gaps).
