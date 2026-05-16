import { prisma } from "@/lib/prisma";
import { encrypt, decrypt, isEncrypted } from "@/lib/services/crypto";

/**
 * Keys whose values are sensitive secrets — auto-encrypted at rest.
 * To add a new key: append here, then run scripts/encrypt-existing-secrets.ts
 * to migrate any existing plaintext rows.
 */
const ENCRYPTED_KEYS = new Set<string>([
  "smtp_pass",
  "msg91_auth_key",
  "biomax_sdk_api_key",
  "telegram_bot_token",
  "telegram_webhook_secret",
  "v3_fitnessboard_password",
  "razorpay_key_secret",
  "manager_action_secret",
]);

export async function getSetting(key: string, defaultValue: string): Promise<string> {
  const row = await prisma.gymSettings.findUnique({ where: { key } });
  if (!row) return defaultValue;
  // Decrypt if value is encrypted (works whether the key is in the whitelist or not —
  // protects against accidental decrypt of legacy-encrypted-but-now-whitelist-removed keys)
  if (isEncrypted(row.value)) {
    return decrypt(row.value);
  }
  return row.value;
}

export async function setSetting(key: string, value: string): Promise<void> {
  const stored = ENCRYPTED_KEYS.has(key) ? encrypt(value) : value;
  await prisma.gymSettings.upsert({
    where: { key },
    update: { value: stored },
    create: { key, value: stored },
  });
}

/** Exported for migration script and tests. */
export function isEncryptedKey(key: string): boolean {
  return ENCRYPTED_KEYS.has(key);
}

export function listEncryptedKeys(): string[] {
  return Array.from(ENCRYPTED_KEYS);
}
