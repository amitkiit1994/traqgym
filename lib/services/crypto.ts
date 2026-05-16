import crypto from "node:crypto";

/**
 * AES-256-GCM encryption for secrets at rest.
 *
 * Format: enc:v1:<iv-hex>:<tag-hex>:<ciphertext-hex>
 *
 * Key comes from DATA_ENCRYPTION_KEY env var (32 bytes, base64-encoded).
 * Generate via: openssl rand -base64 32
 */

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const PREFIX = "enc:v1:";

function loadKey(): Buffer {
  const raw = process.env.DATA_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "DATA_ENCRYPTION_KEY env var is not set. Generate one with " +
        "`openssl rand -base64 32` and add it to .env (and to Vercel env in production)."
    );
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error(
      `DATA_ENCRYPTION_KEY must decode to 32 bytes (got ${key.length}). ` +
        "Generate with `openssl rand -base64 32`."
    );
  }
  return key;
}

export function encrypt(plaintext: string): string {
  const key = loadKey();
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString("hex")}:${tag.toString("hex")}:${ciphertext.toString("hex")}`;
}

export function decrypt(stored: string): string {
  if (!isEncrypted(stored)) {
    throw new Error("decrypt() called on a value that is not in enc:v1: format");
  }
  const key = loadKey();
  const [, , ivHex, tagHex, ctHex] = stored.split(":");
  const iv = Buffer.from(ivHex, "hex");
  const tag = Buffer.from(tagHex, "hex");
  const ciphertext = Buffer.from(ctHex, "hex");
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString("utf8");
}

export function isEncrypted(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith(PREFIX);
}
