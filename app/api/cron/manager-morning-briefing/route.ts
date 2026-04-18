/**
 * Cron: Manager morning briefing.
 *
 * Schedule: 30 1 * * *  (07:00 IST = 01:30 UTC).
 *
 * Auth: Bearer / x-cron-secret / ?secret= matching CRON_SECRET (env).
 *
 * The compose+render+send pipeline lives in `lib/ai/manager-runner.ts`
 * (kept out of the route file because Next.js route handlers may only
 * export HTTP method names + reserved config consts).
 *
 * PR 9 concession: this PR-8-owned route is extended (single-line argument
 * passthrough) so the runner can fan-out to BOTH email and Telegram in one
 * pass. The runner gates on settings (telegram_enabled +
 * gym_owner_telegram_chat_id) so a gym that has only configured email keeps
 * its old single-channel behaviour. We pass no overrides here — let the
 * runner pick channels from settings.
 */

import { runManagerBriefing } from "@/lib/ai/manager-runner";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function readSecret(request: Request): string | null {
  const authHeader = request.headers.get("authorization") ?? "";
  const bearer = authHeader.toLowerCase().startsWith("bearer ")
    ? authHeader.slice(7).trim()
    : null;
  const xHeader = request.headers.get("x-cron-secret");
  const queryParam = new URL(request.url).searchParams.get("secret");
  return bearer ?? xHeader ?? queryParam;
}

export async function GET(request: Request) {
  const presented = readSecret(request);
  if (process.env.CRON_SECRET && presented !== process.env.CRON_SECRET) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  // Channels are picked automatically from settings.
  return runManagerBriefing();
}
