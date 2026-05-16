import { prisma } from "@/lib/prisma";
import { getSetting } from "@/lib/services/settings";
import nodemailer from "nodemailer";

// ─── Notification log dispatch (DB-backed) ──────────────────────────────────

export async function dispatch(params: {
  userId: number;
  templateName: string;
  channel: string;
  recipient?: string;
  deliveryDate: Date;
}) {
  // Check if already dispatched today for this user+template
  const existing = await prisma.notificationLog.findUnique({
    where: {
      userId_templateName_deliveryDate: {
        userId: params.userId,
        templateName: params.templateName,
        deliveryDate: params.deliveryDate,
      },
    },
  });

  if (existing) {
    return { success: true, id: existing.id, skipped: true };
  }

  const log = await prisma.notificationLog.create({
    data: {
      userId: params.userId,
      templateName: params.templateName,
      channel: params.channel,
      recipient: params.recipient ?? null,
      status: "pending",
      deliveryDate: params.deliveryDate,
    },
  });

  return { success: true, id: log.id, skipped: false };
}

export async function markSent(id: number) {
  return prisma.notificationLog.update({
    where: { id },
    data: { status: "sent", sentAt: new Date() },
  });
}

export async function markFailed(id: number, errorMessage: string) {
  return prisma.notificationLog.update({
    where: { id },
    data: { status: "failed", errorMessage },
  });
}

export async function getLog(params?: {
  limit?: number;
  offset?: number;
}) {
  return prisma.notificationLog.findMany({
    include: {
      user: { select: { id: true, firstname: true, lastname: true } },
    },
    orderBy: { createdAt: "desc" },
    take: params?.limit ?? 50,
    skip: params?.offset ?? 0,
  });
}

// ─── Unified send helpers (SMS / email / WhatsApp) ──────────────────────────

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
