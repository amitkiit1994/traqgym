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
  if (!botToken || !botToken.match(/^\d+:[A-Za-z0-9_-]+$/)) {
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
