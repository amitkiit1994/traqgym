"use server";

/**
 * Telegram server actions for the admin Settings UI.
 *
 *   - registerWebhookAction:  Tells Telegram to POST updates to our webhook
 *                             URL with the configured secret token.
 *   - disconnectTelegramAction: Clears the paired chatId.
 *   - sendTestTelegramAction: Sends a test message to the paired chat.
 *   - getPairingInfoAction:   Returns today's pairing code + bot username +
 *                             webhook URL for display in Settings.
 *
 * All require admin role.
 */

import { requireWorker } from "@/lib/auth-guard";
import { getSetting, setSetting } from "@/lib/services/settings";
import {
  setWebhook,
  deleteWebhook,
  sendMessage,
  derivePairingCode,
} from "@/lib/channels/telegram";

function computeWebhookUrl(): string {
  const base =
    process.env.NEXTAUTH_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "http://localhost:3000";
  return `${base.replace(/\/+$/, "")}/api/webhook/telegram`;
}

export type RegisterWebhookResult =
  | { success: true; url: string; mode: "live" | "no_token" }
  | { success: false; error: string };

export async function registerWebhookAction(): Promise<RegisterWebhookResult> {
  try {
    await requireWorker(["admin"]);
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unauthorized",
    };
  }
  if (!process.env.TELEGRAM_BOT_TOKEN) {
    return { success: false, error: "TELEGRAM_BOT_TOKEN not configured" };
  }

  const url = computeWebhookUrl();
  const secret =
    (await getSetting("telegram_webhook_secret", "")) ||
    process.env.TELEGRAM_WEBHOOK_SECRET ||
    "";
  if (!secret) {
    return {
      success: false,
      error:
        "telegram_webhook_secret is empty (set it in Settings or via TELEGRAM_WEBHOOK_SECRET env)",
    };
  }
  const result = await setWebhook({
    url,
    secretToken: secret,
    allowedUpdates: ["message", "callback_query"],
  });
  if (!result.success) {
    return { success: false, error: result.error };
  }
  return { success: true, url, mode: "live" };
}

export type DisconnectTelegramResult =
  | { success: true }
  | { success: false; error: string };

export async function disconnectTelegramAction(): Promise<DisconnectTelegramResult> {
  try {
    await requireWorker(["admin"]);
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unauthorized",
    };
  }
  await setSetting("gym_owner_telegram_chat_id", "");
  await setSetting("gym_owner_telegram_user_id", "");
  // Best-effort: also delete the webhook so the bot stops receiving updates
  // when the gym intentionally disconnects. Comment this out if you want the
  // webhook to remain installed.
  if (process.env.TELEGRAM_BOT_TOKEN) {
    await deleteWebhook().catch(() => {});
  }
  return { success: true };
}

export type SendTestTelegramResult =
  | { success: true; mode: "live" | "dev" }
  | { success: false; error: string };

export async function sendTestTelegramAction(): Promise<SendTestTelegramResult> {
  try {
    await requireWorker(["admin"]);
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unauthorized",
    };
  }
  const chatId = (await getSetting("gym_owner_telegram_chat_id", "")).trim();
  if (!chatId) return { success: false, error: "No paired chat — pair first" };

  const result = await sendMessage({
    chatId,
    text:
      "\u2705 <b>Test message from TraqGym</b>\nIf you see this, the Telegram channel is wired up correctly.",
    parseMode: "HTML",
  });
  if (!result.success) {
    return {
      success: false,
      error: result.error === "no_token" ? "TELEGRAM_BOT_TOKEN not configured" : result.error,
    };
  }
  return { success: true, mode: process.env.TELEGRAM_BOT_TOKEN ? "live" : "dev" };
}

export type PairingInfoResult = {
  pairingCode: string;
  botUsername: string;
  webhookUrl: string;
  webhookSecret: string;
  pairedChatId: string;
  pairedUserId: string;
  enabled: boolean;
};

export async function getPairingInfoAction(): Promise<PairingInfoResult> {
  await requireWorker(["admin"]);
  const botUsername =
    (await getSetting("telegram_bot_username", "")).trim() ||
    process.env.TELEGRAM_BOT_USERNAME ||
    "";
  const webhookSecret =
    (await getSetting("telegram_webhook_secret", "")).trim() ||
    process.env.TELEGRAM_WEBHOOK_SECRET ||
    "";
  return {
    pairingCode: derivePairingCode({ gymId: 1 }),
    botUsername,
    webhookUrl: computeWebhookUrl(),
    webhookSecret: webhookSecret ? "(configured)" : "",
    pairedChatId: (await getSetting("gym_owner_telegram_chat_id", "")).trim(),
    pairedUserId: (await getSetting("gym_owner_telegram_user_id", "")).trim(),
    enabled: (await getSetting("telegram_enabled", "false")) === "true",
  };
}
