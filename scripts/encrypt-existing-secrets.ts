/**
 * Idempotent migration: re-encrypt plaintext values for whitelisted secret keys.
 *
 * Safe to run multiple times — skips rows that are already encrypted.
 *
 * Usage: npx tsx scripts/encrypt-existing-secrets.ts
 * Requires: DATA_ENCRYPTION_KEY env var
 */

import { prisma } from "@/lib/prisma";
import { encrypt, isEncrypted } from "@/lib/services/crypto";
import { listEncryptedKeys } from "@/lib/services/settings";

async function main() {
  const keys = listEncryptedKeys();
  console.log(`Whitelisted secret keys: ${keys.join(", ")}\n`);

  let encrypted = 0;
  let alreadyEncrypted = 0;
  let notPresent = 0;

  for (const key of keys) {
    const row = await prisma.gymSettings.findUnique({ where: { key } });
    if (!row) {
      console.log(`  ${key}: (not set, skipping)`);
      notPresent++;
      continue;
    }
    if (isEncrypted(row.value)) {
      console.log(`  ${key}: already encrypted, skipping`);
      alreadyEncrypted++;
      continue;
    }
    const ciphertext = encrypt(row.value);
    await prisma.gymSettings.update({
      where: { key },
      data: { value: ciphertext },
    });
    console.log(`  ${key}: encrypted (${row.value.length} chars plaintext → ciphertext)`);
    encrypted++;
  }

  console.log(
    `\nSummary: ${encrypted} encrypted, ${alreadyEncrypted} already encrypted, ${notPresent} not present.`
  );
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("ERROR:", err);
  process.exit(1);
});
