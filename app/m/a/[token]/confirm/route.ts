/**
 * Magic-link confirm POST handler.
 *
 * Re-verifies the token (defence in depth — never trust that the GET-side
 * verifier already passed) and executes the chosen insight action via the
 * whitelist dispatcher in lib/services/insight.ts.
 *
 * Replay protection: if the insight was already dismissed (by a previous
 * magic-link click, dashboard action, or another tab), we render an
 * idempotent "Already done" page (200 OK).
 *
 * Auth model: there is no logged-in session at this URL. The signed token
 * IS the auth proof. We attribute the execution to a system worker — the
 * first active admin worker — since `executeInsightAction` requires a real
 * worker FK. This is documented + audited.
 */

import { verifyMagicLink } from "@/lib/ai/manager";
import { prisma } from "@/lib/prisma";
import { executeInsightAction } from "@/lib/services/insight";
import { editMessageText, escapeHtml as escapeTgHtml } from "@/lib/channels/telegram";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function htmlResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

function shellHtml(args: {
  title: string;
  body: string;
  cta?: { label: string; href: string; primary?: boolean };
  variant?: "ok" | "error" | "info";
}): string {
  const accent =
    args.variant === "error"
      ? "#ef4444"
      : args.variant === "info"
        ? "#3b82f6"
        : "#16a34a";
  const ctaHtml = args.cta
    ? `<a href="${escapeHtml(args.cta.href)}" style="display:inline-block;margin-top:18px;padding:12px 22px;background:${args.cta.primary ? "#16a34a" : "#374151"};color:#fff;text-decoration:none;border-radius:8px;font-weight:600;">${escapeHtml(args.cta.label)}</a>`
    : "";
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${escapeHtml(args.title)}</title>
</head>
<body style="margin:0;padding:0;background:#020617;color:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;">
<main style="max-width:520px;width:92%;background:#0f172a;border-radius:14px;padding:32px 28px;box-shadow:0 4px 24px rgba(0,0,0,0.4);text-align:center;">
  <div style="width:48px;height:48px;border-radius:50%;background:${accent}22;display:inline-flex;align-items:center;justify-content:center;margin-bottom:14px;">
    <span style="color:${accent};font-size:24px;font-weight:700;">${args.variant === "error" ? "!" : args.variant === "info" ? "i" : "✓"}</span>
  </div>
  <h1 style="margin:0 0 14px 0;font-size:22px;font-weight:700;color:#f8fafc;">${escapeHtml(args.title)}</h1>
  <div style="color:#cbd5e1;font-size:15px;line-height:1.6;">${args.body}</div>
  ${ctaHtml}
</main>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function resolveSystemWorkerId(): Promise<number | null> {
  // Prefer the lowest-id active admin (typically the gym owner / seed admin).
  const admin = await prisma.worker.findFirst({
    where: { role: "admin", isActive: true },
    select: { id: true },
    orderBy: { id: "asc" },
  });
  if (admin) return admin.id;
  // Fallback to any active worker.
  const any = await prisma.worker.findFirst({
    where: { isActive: true },
    select: { id: true },
    orderBy: { id: "asc" },
  });
  return any?.id ?? null;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  const verified = verifyMagicLink({ token });
  if (!verified.ok) {
    if (verified.error === "expired") {
      return htmlResponse(
        shellHtml({
          title: "Link expired",
          body: "<p>This action link has expired. Open the dashboard to act on the latest insights.</p>",
          cta: { label: "Open dashboard", href: "/admin", primary: true },
          variant: "info",
        }),
        410
      );
    }
    return htmlResponse(
      shellHtml({
        title: "Invalid link",
        body: "<p>This link is malformed or has been tampered with.</p>",
        cta: { label: "Open dashboard", href: "/admin" },
        variant: "error",
      }),
      400
    );
  }

  // Replay protection: check dismissal first.
  const insight = await prisma.insight.findUnique({
    where: { id: verified.insightId },
    select: { id: true, title: true, dismissedAt: true },
  });
  if (!insight) {
    return htmlResponse(
      shellHtml({
        title: "Insight not found",
        body: "<p>The insight referenced by this link no longer exists.</p>",
        cta: { label: "Open dashboard", href: "/admin" },
        variant: "error",
      }),
      404
    );
  }
  if (insight.dismissedAt) {
    return htmlResponse(
      shellHtml({
        title: "Already done",
        body: `<p>The action on <strong>${escapeHtml(insight.title)}</strong> has already been completed.</p>`,
        cta: { label: "Open dashboard", href: "/admin", primary: true },
        variant: "info",
      }),
      200
    );
  }

  const systemWorkerId = await resolveSystemWorkerId();
  if (systemWorkerId === null) {
    return htmlResponse(
      shellHtml({
        title: "Cannot execute",
        body: "<p>No active worker is available to attribute this action to. Please open the dashboard and act manually.</p>",
        cta: { label: "Open dashboard", href: "/admin" },
        variant: "error",
      }),
      500
    );
  }

  const result = await executeInsightAction({
    insightId: verified.insightId,
    actionIndex: verified.actionIndex,
    executedById: systemWorkerId,
  });

  if (!result.success) {
    return htmlResponse(
      shellHtml({
        title: "Action failed",
        body: `<p>${escapeHtml(result.error)}</p>`,
        cta: { label: "Open dashboard", href: "/admin" },
        variant: "error",
      }),
      400
    );
  }

  // Mark insight dismissed so subsequent clicks are idempotent. Also note
  // attribution in audit log via dismissedById = system worker.
  try {
    await prisma.insight.update({
      where: { id: verified.insightId },
      data: { dismissedAt: new Date(), dismissedById: systemWorkerId },
    });
  } catch (err) {
    console.warn("[manager-confirm] dismiss after action failed:", err);
  }

  // Audit trail (best-effort).
  try {
    await prisma.auditLog.create({
      data: {
        action: "manager.magic_link.execute",
        status: "success",
        actorId: systemWorkerId,
        actorType: "worker",
        details: JSON.stringify({
          insightId: verified.insightId,
          actionIndex: verified.actionIndex,
          via: "email_magic_link",
        }),
      },
    });
  } catch (err) {
    console.warn("[manager-confirm] audit log failed:", err);
  }

  // ── PR 16 K.4 — cross-channel sync. Look up every Telegram delivery for
  // this insight and edit the original message to "Done via email" so both
  // channels stay coherent. Best-effort (one chat may have already been
  // edited to "Already done" by a previous action).
  try {
    const tgDeliveries = await prisma.insightDelivery.findMany({
      where: {
        insightId: verified.insightId,
        channel: "telegram",
        telegramChatId: { not: null },
        telegramMessageId: { not: null },
      },
      select: {
        id: true,
        telegramChatId: true,
        telegramMessageId: true,
      },
    });
    if (tgDeliveries.length > 0) {
      const safeTitle = escapeTgHtml(insight.title);
      await Promise.all(
        tgDeliveries.map((d) =>
          editMessageText({
            chatId: d.telegramChatId as string,
            messageId: d.telegramMessageId as number,
            text: `\u2705 <b>${safeTitle}</b>\n<i>Done via email</i>`,
            parseMode: "HTML",
          }).catch((err) =>
            console.warn(
              "[manager-confirm] cross-channel edit failed:",
              err
            )
          )
        )
      );
    }
  } catch (err) {
    console.warn("[manager-confirm] cross-channel sync lookup failed:", err);
  }

  return htmlResponse(
    shellHtml({
      title: "Done",
      body: `<p>Action executed for <strong>${escapeHtml(insight.title)}</strong>.</p>`,
      cta: { label: "Open dashboard", href: "/admin", primary: true },
      variant: "ok",
    }),
    200
  );
}
