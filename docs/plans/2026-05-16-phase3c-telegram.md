# Phase 3c: Telegram One-Click Setup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**Goal:** Give gym admins a self-serve Telegram bot setup. Admin pastes bot token → backend validates via Telegram `getMe`, encrypts + stores it, registers webhook automatically, and shows the daily pair code. Owner sends `/pair <code>` to bot → done.

**Architecture:** New `lib/actions/telegram-setup.ts` server actions + new admin page `/admin/settings/integrations/telegram`. Reuses existing `lib/channels/telegram.ts` (setWebhook, derivePairingCode) and Phase 2.5 encrypted settings.

**Tech Stack:** Next.js server actions, Base UI form components, existing telegram channel module.

**Source spec:** `docs/specs/2026-05-16-path-to-prod-design.md` Phase 3c.

**Scope note:** Pair code is still 8 hex chars in this phase (uses existing `derivePairingCode`). Lengthening to 16 hex + rate-limiting is in Phase 5d.

---

### Task 1: Server actions — `lib/actions/telegram-setup.ts`

**Files:**
- Create: `lib/actions/telegram-setup.ts`
- Create: `tests/unit/telegram-setup.test.ts`

- [ ] **Step 1: Failing test** — create `tests/unit/telegram-setup.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import crypto from "node:crypto";

// Mock Prisma
vi.mock("@/lib/prisma", () => {
  const store = new Map<string, string>();
  return {
    prisma: {
      gymSettings: {
        findUnique: vi.fn(({ where }: { where: { key: string } }) =>
          Promise.resolve(store.has(where.key) ? { key: where.key, value: store.get(where.key) } : null)
        ),
        upsert: vi.fn(({ where, create, update }: { where: { key: string }; create: { key: string; value: string }; update: { value: string } }) => {
          store.set(where.key, store.has(where.key) ? update.value : create.value);
          return Promise.resolve({ key: where.key, value: store.get(where.key) });
        }),
      },
    },
  };
});

// Mock auth-guard so we don't need a session
vi.mock("@/lib/auth-guard", () => ({
  requireWorker: vi.fn(() => Promise.resolve({ userId: 1, role: "admin", locationId: 1 })),
}));

// Mock global fetch for Telegram API calls
const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

describe("telegram-setup actions", () => {
  beforeEach(() => {
    process.env.DATA_ENCRYPTION_KEY = crypto.randomBytes(32).toString("base64");
    process.env.NEXTAUTH_SECRET = "test-secret-for-pair-code";
    process.env.NEXTAUTH_URL = "https://freeformfitness.traqgym.com";
    fetchMock.mockReset();
    vi.resetModules();
  });

  it("validateBotToken returns bot info when token is valid", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, result: { id: 12345, is_bot: true, first_name: "TraqBot", username: "traqgym_test_bot" } }),
    } as Response);
    const { validateBotToken } = await import("@/lib/actions/telegram-setup");
    const res = await validateBotToken("12345:fake-token");
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.botUsername).toBe("traqgym_test_bot");
      expect(res.botName).toBe("TraqBot");
    }
  });

  it("validateBotToken returns error on invalid token", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ ok: false, description: "Unauthorized" }),
    } as Response);
    const { validateBotToken } = await import("@/lib/actions/telegram-setup");
    const res = await validateBotToken("bad-token");
    expect(res.success).toBe(false);
  });

  it("configureBot stores token + secret + calls setWebhook", async () => {
    // getMe
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, result: { id: 1, is_bot: true, first_name: "B", username: "b" } }),
    } as Response);
    // setWebhook
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, result: true }),
    } as Response);

    const { configureBot } = await import("@/lib/actions/telegram-setup");
    const res = await configureBot({ botToken: "12345:fake" });
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.botUsername).toBe("b");
      expect(res.pairCode).toMatch(/^[0-9a-f]{8}$/);
      expect(res.webhookUrl).toContain("/api/webhook/telegram");
    }

    // Token stored encrypted
    const { prisma } = await import("@/lib/prisma");
    const tokenRow = await prisma.gymSettings.findUnique({ where: { key: "telegram_bot_token" } });
    expect(tokenRow?.value).toMatch(/^enc:v1:/);
    // Username stored plaintext
    const usernameRow = await prisma.gymSettings.findUnique({ where: { key: "telegram_bot_username" } });
    expect(usernameRow?.value).toBe("b");
    // Webhook secret stored encrypted
    const secretRow = await prisma.gymSettings.findUnique({ where: { key: "telegram_webhook_secret" } });
    expect(secretRow?.value).toMatch(/^enc:v1:/);
  });

  it("getSetupStatus reports configured/unconfigured correctly", async () => {
    const { getSetupStatus } = await import("@/lib/actions/telegram-setup");
    const before = await getSetupStatus();
    expect(before.configured).toBe(false);

    const { setSetting } = await import("@/lib/services/settings");
    await setSetting("telegram_bot_token", "12345:fake");
    await setSetting("telegram_bot_username", "demo_bot");

    const after = await getSetupStatus();
    expect(after.configured).toBe(true);
    expect(after.botUsername).toBe("demo_bot");
    expect(after.pairCode).toMatch(/^[0-9a-f]{8}$/);
  });
});
```

- [ ] **Step 2: Confirm test fails**

```bash
cd /Users/amitkumardas/freeformOS/freeformfitnessOS
DATA_ENCRYPTION_KEY=$(openssl rand -base64 32) NEXTAUTH_SECRET=test npx vitest run tests/unit/telegram-setup.test.ts --config=vitest.unit.config.ts 2>&1 | tail -10
```
Expected: fails because `lib/actions/telegram-setup.ts` doesn't exist.

- [ ] **Step 3: Implement `lib/actions/telegram-setup.ts`**

Create `lib/actions/telegram-setup.ts`:

```typescript
"use server";

import crypto from "node:crypto";
import { requireWorker } from "@/lib/auth-guard";
import { getSetting, setSetting } from "@/lib/services/settings";
import { setWebhook, derivePairingCode } from "@/lib/channels/telegram";
import { revalidatePath } from "next/cache";

export type ValidateResult =
  | { success: true; botUsername: string; botName: string; botId: number }
  | { success: false; error: string };

export type ConfigureResult =
  | { success: true; botUsername: string; pairCode: string; webhookUrl: string }
  | { success: false; error: string };

export type SetupStatus = {
  configured: boolean;
  botUsername?: string;
  pairCode?: string;
  ownerChatId?: string;
};

/**
 * Calls Telegram getMe to confirm a bot token is valid.
 * Does NOT store anything. Used by the admin UI for an "I'd like to test
 * this token before saving" pass.
 */
export async function validateBotToken(botToken: string): Promise<ValidateResult> {
  if (!botToken || !botToken.match(/^\d+:[A-Za-z0-9_-]{30,}$/)) {
    return { success: false, error: "Token format looks wrong. It should look like '12345:ABC...' from @BotFather." };
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/getMe`);
    const json = (await res.json()) as { ok: boolean; result?: { id: number; is_bot: boolean; first_name: string; username: string }; description?: string };
    if (!res.ok || !json.ok || !json.result) {
      return { success: false, error: json.description ?? `Telegram getMe failed: HTTP ${res.status}` };
    }
    return {
      success: true,
      botUsername: json.result.username,
      botName: json.result.first_name,
      botId: json.result.id,
    };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Network error contacting Telegram" };
  }
}

/**
 * Full setup: validates token via getMe, saves token+username+webhook-secret
 * (encrypted at rest via settings service), registers webhook with Telegram,
 * returns pair code for the owner to send.
 *
 * Admin-only.
 */
export async function configureBot(params: { botToken: string }): Promise<ConfigureResult> {
  await requireWorker(["admin"]);

  const validation = await validateBotToken(params.botToken);
  if (!validation.success) return validation;

  // Generate a random webhook secret (must be 1-256 chars, A-Z a-z 0-9 _ - per Telegram docs)
  const webhookSecret = crypto.randomBytes(32).toString("hex");

  // Derive the webhook URL from NEXTAUTH_URL (the gym's own subdomain)
  const baseUrl = process.env.NEXTAUTH_URL;
  if (!baseUrl) {
    return { success: false, error: "NEXTAUTH_URL env var is not set — cannot derive webhook URL." };
  }
  const webhookUrl = `${baseUrl.replace(/\/$/, "")}/api/webhook/telegram`;

  // Save settings (token + secret get encrypted automatically by settings service whitelist)
  await setSetting("telegram_bot_token", params.botToken);
  await setSetting("telegram_bot_username", validation.botUsername);
  await setSetting("telegram_webhook_secret", webhookSecret);

  // Register the webhook with Telegram. Use the just-saved token directly
  // (setWebhook reads it from env or from where the channel module reads it,
  // but the call goes through the Telegram API and needs the token in the URL).
  // We pass our own fetch here instead of relying on a global TELEGRAM_BOT_TOKEN.
  const setRes = await fetch(`https://api.telegram.org/bot${params.botToken}/setWebhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url: webhookUrl,
      secret_token: webhookSecret,
      allowed_updates: ["message", "callback_query"],
      drop_pending_updates: false,
    }),
  });
  const setJson = (await setRes.json()) as { ok: boolean; description?: string };
  if (!setRes.ok || !setJson.ok) {
    return {
      success: false,
      error: `Token saved but webhook registration failed: ${setJson.description ?? `HTTP ${setRes.status}`}. Retry by saving again.`,
    };
  }

  const pairCode = derivePairingCode({ gymId: 1 });

  revalidatePath("/admin/settings/integrations/telegram");

  return {
    success: true,
    botUsername: validation.botUsername,
    pairCode,
    webhookUrl,
  };
}

/**
 * Returns current setup status — used to render the admin page.
 * Pair code regenerates daily; show it whenever the bot is configured but
 * not yet paired.
 */
export async function getSetupStatus(): Promise<SetupStatus> {
  const token = await getSetting("telegram_bot_token", "");
  const username = await getSetting("telegram_bot_username", "");
  const ownerChatId = await getSetting("gym_owner_telegram_chat_id", "");
  if (!token) {
    return { configured: false };
  }
  let pairCode: string | undefined;
  try {
    pairCode = derivePairingCode({ gymId: 1 });
  } catch {
    pairCode = undefined;
  }
  return {
    configured: true,
    botUsername: username || undefined,
    pairCode: ownerChatId ? undefined : pairCode, // hide pair code once paired
    ownerChatId: ownerChatId || undefined,
  };
}

/**
 * Removes the saved bot configuration. Does NOT call deleteWebhook on Telegram —
 * that's a separate concern (a stale webhook is harmless if the token is also
 * gone). Admin can re-configure to overwrite.
 */
export async function disconnectBot(): Promise<{ success: true }> {
  await requireWorker(["admin"]);
  await setSetting("telegram_bot_token", "");
  await setSetting("telegram_bot_username", "");
  await setSetting("telegram_webhook_secret", "");
  await setSetting("gym_owner_telegram_chat_id", "");
  revalidatePath("/admin/settings/integrations/telegram");
  return { success: true };
}
```

- [ ] **Step 4: Run tests pass**

```bash
cd /Users/amitkumardas/freeformOS/freeformfitnessOS
DATA_ENCRYPTION_KEY=$(openssl rand -base64 32) NEXTAUTH_SECRET=test NEXTAUTH_URL=https://freeformfitness.traqgym.com npx vitest run tests/unit/telegram-setup.test.ts --config=vitest.unit.config.ts 2>&1 | tail -10
```
Expected: 4/4 pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/amitkumardas/freeformOS/freeformfitnessOS
git add lib/actions/telegram-setup.ts tests/unit/telegram-setup.test.ts
git commit -m "$(cat <<'EOF'
feat(telegram): server actions for one-click bot setup

- validateBotToken(): calls Telegram getMe to verify token
- configureBot(): saves encrypted token + webhook secret, registers
  webhook with Telegram, returns daily pair code
- getSetupStatus(): drives the admin page render (configured?, pair code,
  owner chat id)
- disconnectBot(): wipes config (admin can re-configure)

Token + webhook secret stored encrypted at rest via Phase 2.5 settings
whitelist. Webhook URL derived from NEXTAUTH_URL — no manual config.

Tests: 4/4 (token validation success/fail, configure round-trip with
encryption verified, status reporting).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Admin page — `/admin/settings/integrations/telegram`

**Files:**
- Create: `app/admin/settings/integrations/telegram/page.tsx`

- [ ] **Step 1: Implement the page**

Create the directory + page:

```bash
cd /Users/amitkumardas/freeformOS/freeformfitnessOS
mkdir -p app/admin/settings/integrations/telegram
```

Then create `app/admin/settings/integrations/telegram/page.tsx`:

```typescript
import { getSetupStatus } from "@/lib/actions/telegram-setup";
import { TelegramSetupForm } from "./form";

export const dynamic = "force-dynamic";

export default async function TelegramIntegrationPage() {
  const status = await getSetupStatus();

  return (
    <div className="container max-w-2xl py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Telegram Bot Integration</h1>
        <p className="text-muted-foreground mt-2">
          Connect a Telegram bot so the gym owner can chat with TraqGym AI
          (member lookups, daily briefings, renewals).
        </p>
      </div>

      <div className="rounded-lg border bg-card p-6">
        <h2 className="font-semibold mb-3">How to set up</h2>
        <ol className="space-y-2 text-sm list-decimal pl-5">
          <li>
            Open <a className="underline" href="https://t.me/BotFather" target="_blank" rel="noopener noreferrer">@BotFather</a> on Telegram
          </li>
          <li>
            Send <code className="rounded bg-muted px-1.5 py-0.5">/newbot</code> and follow the prompts. Name it something like &quot;Free Form Fitness AI&quot;.
          </li>
          <li>
            Copy the bot token (looks like <code className="rounded bg-muted px-1.5 py-0.5">123456789:ABC...</code>) and paste below.
          </li>
          <li>
            Click <strong>Connect Bot</strong>. We&apos;ll validate, save, and register the webhook automatically.
          </li>
          <li>
            Open the bot in Telegram (it will show a t.me link after connect), send <code className="rounded bg-muted px-1.5 py-0.5">/pair {"{code}"}</code> using the code shown below.
          </li>
        </ol>
      </div>

      <TelegramSetupForm initialStatus={status} />
    </div>
  );
}
```

- [ ] **Step 2: Create the client-side form component**

Create `app/admin/settings/integrations/telegram/form.tsx`:

```typescript
"use client";

import { useState, useTransition } from "react";
import {
  configureBot,
  disconnectBot,
  validateBotToken,
  type SetupStatus,
} from "@/lib/actions/telegram-setup";

export function TelegramSetupForm({
  initialStatus,
}: {
  initialStatus: SetupStatus;
}) {
  const [status, setStatus] = useState(initialStatus);
  const [token, setToken] = useState("");
  const [message, setMessage] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [validating, startValidate] = useTransition();
  const [saving, startSave] = useTransition();

  if (status.configured) {
    return (
      <div className="rounded-lg border bg-card p-6 space-y-4">
        <div className="flex items-center gap-2">
          <span className="inline-block size-2 rounded-full bg-green-500" />
          <h2 className="font-semibold">Bot connected</h2>
        </div>
        <div className="text-sm space-y-1">
          <div>
            <span className="text-muted-foreground">Bot:</span>{" "}
            <a
              className="underline font-medium"
              href={`https://t.me/${status.botUsername}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              @{status.botUsername}
            </a>
          </div>
          {status.ownerChatId ? (
            <div>
              <span className="text-muted-foreground">Owner chat:</span>{" "}
              <code className="rounded bg-muted px-1.5 py-0.5">
                {status.ownerChatId}
              </code>{" "}
              <span className="text-green-600">(paired)</span>
            </div>
          ) : status.pairCode ? (
            <div className="rounded-md border border-amber-500/40 bg-amber-50 dark:bg-amber-950/30 p-3 mt-3">
              <div className="text-sm font-medium mb-1">
                Owner needs to pair (one-time):
              </div>
              <div className="text-sm">
                Open{" "}
                <a
                  className="underline"
                  href={`https://t.me/${status.botUsername}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  @{status.botUsername}
                </a>{" "}
                and send:{" "}
                <code className="rounded bg-muted px-1.5 py-0.5 font-bold">
                  /pair {status.pairCode}
                </code>
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                Code refreshes daily.
              </div>
            </div>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => {
            if (!confirm("Disconnect the Telegram bot? Saved token and pairing will be removed.")) return;
            startSave(async () => {
              await disconnectBot();
              setStatus({ configured: false });
              setMessage({ type: "ok", text: "Disconnected." });
            });
          }}
          disabled={saving}
          className="text-sm text-destructive underline disabled:opacity-50"
        >
          Disconnect bot
        </button>
      </div>
    );
  }

  return (
    <form
      className="rounded-lg border bg-card p-6 space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        setMessage(null);
        startSave(async () => {
          const res = await configureBot({ botToken: token });
          if (res.success) {
            setStatus({
              configured: true,
              botUsername: res.botUsername,
              pairCode: res.pairCode,
            });
            setMessage({ type: "ok", text: `Connected @${res.botUsername}.` });
            setToken("");
          } else {
            setMessage({ type: "err", text: res.error });
          }
        });
      }}
    >
      <h2 className="font-semibold">Connect a bot</h2>
      <div className="space-y-2">
        <label className="text-sm font-medium" htmlFor="bot-token">
          Bot token from @BotFather
        </label>
        <input
          id="bot-token"
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="123456789:ABCdefGHIjklMNOpqrSTUvwxYZ-1234567890"
          className="w-full rounded-md border bg-background px-3 py-2 text-sm font-mono"
          required
        />
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => {
            setMessage(null);
            startValidate(async () => {
              const res = await validateBotToken(token);
              setMessage(
                res.success
                  ? {
                      type: "ok",
                      text: `Valid: @${res.botUsername} (${res.botName})`,
                    }
                  : { type: "err", text: res.error }
              );
            });
          }}
          disabled={!token || validating || saving}
          className="rounded-md border px-3 py-1.5 text-sm disabled:opacity-50"
        >
          {validating ? "Checking…" : "Test token"}
        </button>
        <button
          type="submit"
          disabled={!token || saving || validating}
          className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-50"
        >
          {saving ? "Connecting…" : "Connect bot"}
        </button>
      </div>

      {message ? (
        <div
          className={
            "rounded-md p-3 text-sm " +
            (message.type === "ok"
              ? "border border-green-500/40 bg-green-50 dark:bg-green-950/30"
              : "border border-destructive/40 bg-destructive/10")
          }
        >
          {message.text}
        </div>
      ) : null}
    </form>
  );
}
```

- [ ] **Step 3: Type check**

```bash
cd /Users/amitkumardas/freeformOS/freeformfitnessOS
npx tsc --noEmit 2>&1 | grep -E "telegram|integrations" | head -10
```
Expected: NO output (no errors in our new files).

- [ ] **Step 4: Commit**

```bash
cd /Users/amitkumardas/freeformOS/freeformfitnessOS
git add app/admin/settings/integrations/telegram/page.tsx app/admin/settings/integrations/telegram/form.tsx
git commit -m "$(cat <<'EOF'
feat(admin): one-click Telegram bot setup page

/admin/settings/integrations/telegram

- Step-by-step instructions linking to @BotFather
- Token validation via Telegram getMe before save
- One-click connect: validates, saves encrypted, registers webhook,
  shows pair code
- Pair code regenerates daily; hidden once owner has paired
- Disconnect button wipes saved token + pairing

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Final verification

- [ ] **Step 1: All unit tests**

```bash
cd /Users/amitkumardas/freeformOS/freeformfitnessOS
DATA_ENCRYPTION_KEY=$(openssl rand -base64 32) NEXTAUTH_SECRET=test NEXTAUTH_URL=https://freeformfitness.traqgym.com npx vitest run tests/unit/ --config=vitest.unit.config.ts 2>&1 | tail -10
```
Expected: 16/16 + 3 pre-existing ux-component failures (acknowledged in Phase 3b report).

- [ ] **Step 2: Type check (no new errors)**

```bash
cd /Users/amitkumardas/freeformOS/freeformfitnessOS
npx tsc --noEmit 2>&1 | wc -l
```
Expected: 35 lines (same as baseline).

- [ ] **Step 3: Git log**

```bash
cd /Users/amitkumardas/freeformOS/freeformfitnessOS
git log --oneline -8
```
Expected: 2 new commits on top of Phase 3b.

## Done criteria

- [ ] `lib/actions/telegram-setup.ts` exists, 4 tests pass
- [ ] `app/admin/settings/integrations/telegram/page.tsx` + `form.tsx` exist
- [ ] Encryption verified (test asserts ciphertext format)
- [ ] 2 commits on main

## Next phase trigger

Phase 3c done → next is Phase 5 (security/ops) which is the biggest of the remaining phases — multiple sub-items.
