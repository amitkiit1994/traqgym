import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireInternalSecret } from "@/lib/auth-internal";
import { getSetting } from "@/lib/services/settings";

/**
 * POST /api/internal/v3-credentials
 *
 * Returns the decrypted v3.fitnessboard.in credentials for the nightly sync
 * runner. POST-only because GET would tempt copy/pasting the secret-bearing
 * URL into logs.
 *
 * Auth: Authorization: Bearer <INTERNAL_API_SECRET>
 *
 * Response:
 *   {
 *     configured: boolean,
 *     mobile: string | null,
 *     password: string | null,  // DECRYPTED
 *     syncEnabled: boolean,
 *     lastSyncAt: string | null,
 *   }
 *
 * If syncEnabled is false the runner should skip the gym (still returns
 * credentials in case ops wants to force a one-off sync).
 */
export async function POST(req: NextRequest) {
  const guard = requireInternalSecret(req);
  if (guard) return guard;

  const mobile = await getSetting("v3_fitnessboard_mobile", "");
  const password = await getSetting("v3_fitnessboard_password", "");
  const syncEnabled = (await getSetting("v3_sync_enabled", "false")) === "true";
  const lastSyncAt = await getSetting("v3_last_sync_at", "");

  return NextResponse.json({
    configured: Boolean(mobile && password),
    mobile: mobile || null,
    password: password || null,
    syncEnabled,
    lastSyncAt: lastSyncAt || null,
  });
}
