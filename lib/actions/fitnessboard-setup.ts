"use server";

import { requireWorker } from "@/lib/auth-guard";
import { getSetting, setSetting } from "@/lib/services/settings";
import { revalidatePath } from "next/cache";

export type ValidateResult =
  | { success: true }
  | { success: false; error: string };

export type SaveResult =
  | { success: true }
  | { success: false; error: string };

export type FitnessboardStatus = {
  configured: boolean;
  mobile?: string;
  syncEnabled?: boolean;
  lastSyncAt?: string;
  lastSyncStatus?: string;
};

const V3_BASE = "https://v3.fitnessboard.in";

function isValidMobile(mobile: string): boolean {
  return /^\d{10}$/.test(mobile);
}

/**
 * Attempt a login against v3.fitnessboard.in with the given mobile + password.
 * Does NOT persist anything — used by the admin UI's "Test connection" button.
 *
 * The legacy v3 login form POSTs to /Account/Login with `Mobile` + `Password`
 * fields and responds with a 302 redirect. Success → /Dashboard/Branchlist (or
 * similar). Failure → /Account/LoginError.
 */
export async function validateFitnessboardLogin(
  mobile: string,
  password: string
): Promise<ValidateResult> {
  if (!isValidMobile(mobile)) {
    return { success: false, error: "Mobile must be a 10-digit number." };
  }
  if (!password) {
    return { success: false, error: "Password is required." };
  }
  try {
    const body = new URLSearchParams({ Mobile: mobile, Password: password });
    const res = await fetch(`${V3_BASE}/Account/Login`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      redirect: "manual",
    });
    const location = res.headers.get("location") ?? "";
    if (res.status === 302 && location) {
      if (/Branchlist/i.test(location) || /Dashboard/i.test(location)) {
        return { success: true };
      }
      if (/LoginError/i.test(location)) {
        return { success: false, error: "Invalid credentials — v3 rejected the login." };
      }
      return { success: false, error: `Unexpected redirect from v3: ${location}` };
    }
    return {
      success: false,
      error: `Unexpected response from v3 (HTTP ${res.status}). The v3 site may be down or the login form has changed.`,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Network error contacting v3.fitnessboard.in",
    };
  }
}

/**
 * Save the v3 FitnessBoard credentials to GymSettings.
 *  - mobile stored plaintext (key: v3_fitnessboard_mobile)
 *  - password stored encrypted (key: v3_fitnessboard_password — in encryption whitelist)
 *  - syncEnabled flag stored plaintext (key: v3_sync_enabled)
 *
 * Admin-only.
 */
export async function saveFitnessboardConfig(params: {
  mobile: string;
  password: string;
  syncEnabled: boolean;
}): Promise<SaveResult> {
  await requireWorker(["admin"]);
  if (!isValidMobile(params.mobile)) {
    return { success: false, error: "Mobile must be a 10-digit number." };
  }
  if (!params.password) {
    return { success: false, error: "Password is required." };
  }
  await setSetting("v3_fitnessboard_mobile", params.mobile);
  await setSetting("v3_fitnessboard_password", params.password);
  await setSetting("v3_sync_enabled", params.syncEnabled ? "true" : "false");
  revalidatePath("/admin/settings/integrations/fitnessboard");
  return { success: true };
}

/**
 * Returns current setup status — used to render the admin page. Does NOT
 * return the password (it's encrypted at rest and never needed by the UI).
 */
export async function getFitnessboardStatus(): Promise<FitnessboardStatus> {
  const mobile = await getSetting("v3_fitnessboard_mobile", "");
  const password = await getSetting("v3_fitnessboard_password", "");
  const syncEnabled = await getSetting("v3_sync_enabled", "false");
  const lastSyncAt = await getSetting("v3_last_sync_at", "");
  const lastSyncStatus = await getSetting("v3_last_sync_status", "");
  const configured = Boolean(mobile && password);
  return {
    configured,
    mobile: mobile || undefined,
    syncEnabled: syncEnabled === "true",
    lastSyncAt: lastSyncAt || undefined,
    lastSyncStatus: lastSyncStatus || undefined,
  };
}

/**
 * Manual disconnect — clears the stored credentials and disables sync.
 */
export async function disconnectFitnessboard(): Promise<{ success: true }> {
  await requireWorker(["admin"]);
  await setSetting("v3_fitnessboard_mobile", "");
  await setSetting("v3_fitnessboard_password", "");
  await setSetting("v3_sync_enabled", "false");
  revalidatePath("/admin/settings/integrations/fitnessboard");
  return { success: true };
}

/**
 * Marks the gym for a manual sync on the next nightly cron run. v1 just
 * stamps a status note; the actual fetch is done by the GH Action.
 */
export async function queueManualSync(): Promise<{ success: true; message: string }> {
  await requireWorker(["admin"]);
  await setSetting(
    "v3_last_sync_status",
    `queued: manual run requested at ${new Date().toISOString()}`
  );
  revalidatePath("/admin/settings/integrations/fitnessboard");
  return {
    success: true,
    message:
      "Sync queued. It will run on the next nightly cron (02:30 IST). For immediate sync, contact ops to trigger the GH workflow manually.",
  };
}
