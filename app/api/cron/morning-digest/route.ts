/**
 * Cron: DB-backed morning digest (Task #78 — one chat for the owner).
 *
 * Schedule: 25 3 * * *  (08:55 IST = 03:25 UTC) — five minutes BEFORE the
 * standalone telegram-bot's 09:00 IST CSV digest, so during the shadow
 * window both exist and the lead can compare them side by side.
 *
 * Mode comes from GymSettings `digest_source` (default "shadow"):
 *   shadow  build from the app DB, upsert a DigestRun row (text +
 *           comparison metrics) — WITHOUT sending anything. Only metrics
 *           are logged (the text carries member names/phones; PII stays
 *           out of logger lines). The legacy CSV digest remains the
 *           owner's live brief.
 *   db      send the digest via the in-app bot to the paired owner chat
 *           (gym_owner_telegram_chat_id) and, when the Earned Autonomy
 *           loop is on, attach the action register beneath it. Stores the
 *           DigestRun row and stamps deliveredAt on success — a same-day
 *           re-run upserts the row but never double-sends.
 *   off     no-op.
 *
 * Cutover plan: run shadow for ~3 days, diff DigestRun.metrics against the
 * CSV digest messages (scripts/compare-digest.ts), then set digest_source
 * to "db" and finally disable the telegram-bot digest workflow.
 *
 * Auth: Bearer CRON_SECRET, same as sibling crons (lib/auth-cron.ts).
 */

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireCronSecret } from "@/lib/auth-cron";
import { prisma } from "@/lib/prisma";
import { getSetting } from "@/lib/services/settings";
import { buildDigest } from "@/lib/services/morning-digest";
import { sendMessage } from "@/lib/channels/telegram";
import { sendActionRegister } from "@/lib/ai/action-telegram";
import { isAutonomyEnabled } from "@/lib/services/action-loop";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type DigestMode = "shadow" | "db" | "off";

async function getDigestMode(): Promise<DigestMode> {
  try {
    const raw = (await getSetting("digest_source", "shadow"))
      .trim()
      .toLowerCase();
    if (raw === "db" || raw === "off") return raw;
    return "shadow"; // default + any unknown value fails safe (no send)
  } catch {
    return "shadow";
  }
}

export async function GET(req: NextRequest) {
  const guard = requireCronSecret(req);
  if (guard) return guard;

  const mode = await getDigestMode();
  if (mode === "off") {
    return NextResponse.json({ ok: true, mode, skipped: true });
  }

  const digest = await buildDigest();
  if (!digest.success) {
    console.error("[morning-digest cron] build failed:", digest.error);
    return NextResponse.json(
      { ok: false, mode, error: digest.error },
      { status: 500 }
    );
  }

  // One row per IST date (unique) — a manual re-run the same morning
  // overwrites text/metrics rather than erroring, keeping the comparison
  // log clean. The row doubles as the send-dedupe guard: deliveredAt is
  // stamped only after a successful db-mode send, and the update path
  // never touches it, so a same-day re-run (manual trigger, Vercel retry)
  // can never send twice.
  let stored = true;
  let alreadyDelivered = false;
  try {
    const existing = await prisma.digestRun.findUnique({
      where: { date: digest.date },
      select: { deliveredAt: true },
    });
    alreadyDelivered = existing?.deliveredAt != null;
    await prisma.digestRun.upsert({
      where: { date: digest.date },
      update: { source: mode, text: digest.text, metrics: digest.metrics },
      create: {
        date: digest.date,
        source: mode,
        text: digest.text,
        metrics: digest.metrics,
      },
    });
  } catch (err) {
    // Storage failure must not block delivery in db mode.
    stored = false;
    console.error("[morning-digest cron] DigestRun store failed:", err);
  }

  if (mode === "shadow") {
    // Metrics only in the function log — the full digest text carries
    // member names/phones (PII stays out of logger lines). The text lives
    // in the DigestRun row; read it via scripts/compare-digest.ts --text.
    console.log(
      `[morning-digest cron] SHADOW run for ${digest.date} stored (not sent); ` +
        `metrics=${JSON.stringify(digest.metrics)}`
    );
    return NextResponse.json({
      ok: true,
      mode,
      stored,
      date: digest.date,
      metrics: digest.metrics,
    });
  }

  // mode === "db": deliver to the paired owner chat via the in-app bot.
  const chatId = (await getSetting("gym_owner_telegram_chat_id", "")).trim();
  if (!chatId) {
    console.error(
      "[morning-digest cron] digest_source=db but no owner chat is paired (gym_owner_telegram_chat_id empty)"
    );
    return NextResponse.json(
      { ok: false, mode, stored, error: "no_owner_chat_paired" },
      { status: 200 } // config gap, not a transient failure — don't page retries
    );
  }

  if (alreadyDelivered) {
    console.log(
      `[morning-digest cron] digest for ${digest.date} already delivered — skipping send (same-day re-run)`
    );
    return NextResponse.json({
      ok: true,
      mode,
      stored,
      date: digest.date,
      delivered: false,
      alreadyDelivered: true,
    });
  }

  const sent = await sendMessage({
    chatId,
    text: digest.text,
    parseMode: "HTML",
  });
  if (!sent.success) {
    console.error("[morning-digest cron] send failed:", sent.error);
    return NextResponse.json(
      { ok: false, mode, stored, error: `send_failed: ${sent.error}` },
      { status: 500 }
    );
  }

  // Stamp the dedupe marker the moment the send succeeds — before the
  // action register, so a crash between the two can't re-send the brief.
  try {
    await prisma.digestRun.update({
      where: { date: digest.date },
      data: { deliveredAt: new Date() },
    });
  } catch (err) {
    console.error("[morning-digest cron] deliveredAt stamp failed:", err);
  }

  // Action register beneath the brief — the verify surface with
  // [Approve]/[Reject] buttons. sendActionRegister no-ops cleanly when
  // autonomy is off; the explicit check just keeps the response honest.
  let registerSent = 0;
  if (await isAutonomyEnabled()) {
    const reg = await sendActionRegister(chatId);
    if (reg.success) {
      registerSent = reg.sent;
    } else {
      console.warn("[morning-digest cron] action register failed:", reg.error);
    }
  }

  return NextResponse.json({
    ok: true,
    mode,
    stored,
    date: digest.date,
    delivered: true,
    registerMessages: registerSent,
    metrics: digest.metrics,
  });
}
