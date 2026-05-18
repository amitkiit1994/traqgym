/**
 * Reset a Worker's password (typically the admin) to a known value.
 *
 * Dry-run by default — prints what WOULD happen. Pass --apply to actually
 * write the new bcrypt hash to the Worker row. Hits whatever DB the
 * DATABASE_URL env var points at, so for production:
 *
 *   vercel env pull --environment=production .env.prod
 *   DATABASE_URL="$(grep ^DATABASE_URL .env.prod | cut -d= -f2- | tr -d '"')" \
 *     npx tsx scripts/reset-admin-password.ts \
 *     --email admin@freeformfitness.com --password password123 --apply
 *
 * Usage:
 *   --email <email>      Worker email (required)
 *   --password <pw>      New password in plaintext (required)
 *   --apply              Actually write. Omit for dry-run.
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const email = arg("email");
  const password = arg("password");
  const apply = process.argv.includes("--apply");

  if (!email || !password) {
    console.error("Usage: tsx scripts/reset-admin-password.ts --email <email> --password <pw> [--apply]");
    process.exit(1);
  }

  const prisma = new PrismaClient();
  try {
    const worker = await prisma.worker.findUnique({
      where: { email },
      select: { id: true, email: true, firstname: true, lastname: true, role: true, isActive: true },
    });
    if (!worker) {
      console.error(`No Worker with email=${email}`);
      process.exit(2);
    }

    console.log("Found worker:", worker);

    if (!apply) {
      console.log(`DRY-RUN: would bcrypt-hash the new password and update Worker id=${worker.id}`);
      console.log("Re-run with --apply to actually write.");
      return;
    }

    const hash = await bcrypt.hash(password, 10);
    await prisma.worker.update({
      where: { id: worker.id },
      data: { password: hash },
    });
    console.log(`OK: password reset for ${email} (worker id=${worker.id})`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
