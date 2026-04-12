/**
 * Reset + Re-migrate FitnessBoard data
 *
 * Cleans all FitnessBoard-imported data and re-runs migration fresh.
 * Also updates gym name to "Free Form Fitness".
 *
 * Usage: npx tsx scripts/reset-fitnessboard.ts
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("=== Resetting FitnessBoard Data ===\n");

  // Find the FFF location
  const location = await prisma.location.findFirst({ where: { code: "FFF" } });
  if (!location) {
    console.log("No FFF location found — nothing to clean. Running migration...");
    return runMigration();
  }

  const locId = location.id;
  console.log(`Found location: id=${locId} name="${location.name}"`);

  // Delete in reverse FK order
  console.log("Deleting EnquiryFollowups...");
  const efCount = await prisma.enquiryFollowup.deleteMany({
    where: { enquiry: { locationId: locId } },
  });
  console.log(`  Deleted: ${efCount.count}`);

  console.log("Deleting PaymentFollowups...");
  const pfCount = await prisma.paymentFollowup.deleteMany({
    where: { user: { locationId: locId } },
  });
  console.log(`  Deleted: ${pfCount.count}`);

  console.log("Deleting Invoices...");
  const invCount = await prisma.invoice.deleteMany({
    where: { payment: { locationId: locId } },
  });
  console.log(`  Deleted: ${invCount.count}`);

  console.log("Deleting Payments...");
  const payCount = await prisma.payment.deleteMany({
    where: { locationId: locId },
  });
  console.log(`  Deleted: ${payCount.count}`);

  console.log("Deleting MemberTickets...");
  const ticketCount = await prisma.memberTicket.deleteMany({
    where: { locationId: locId },
  });
  console.log(`  Deleted: ${ticketCount.count}`);

  console.log("Deleting Enquiries...");
  const enqCount = await prisma.enquiry.deleteMany({
    where: { locationId: locId },
  });
  console.log(`  Deleted: ${enqCount.count}`);

  console.log("Deleting Users...");
  const userCount = await prisma.user.deleteMany({
    where: { locationId: locId },
  });
  console.log(`  Deleted: ${userCount.count}`);

  console.log("Deleting Workers...");
  const workerCount = await prisma.worker.deleteMany({
    where: { locationId: locId },
  });
  console.log(`  Deleted: ${workerCount.count}`);

  console.log("Deleting migration marker...");
  await prisma.gymSettings.deleteMany({
    where: { key: "fitnessboard_migration_complete" },
  });

  // Update gym name
  console.log("\nUpdating gym name to 'Free Form Fitness'...");
  await prisma.gymSettings.upsert({
    where: { key: "gym_name" },
    update: { value: "Free Form Fitness" },
    create: { key: "gym_name", value: "Free Form Fitness" },
  });

  // Update location name
  await prisma.location.update({
    where: { id: locId },
    data: { name: "Free Form Fitness" },
  });

  console.log("\n=== Cleanup complete. Running migration... ===\n");
  await runMigration();
}

async function runMigration() {
  // Import and run the migration script
  const { execSync } = require("child_process");
  execSync("npx tsx scripts/migrate-fitnessboard.ts", {
    stdio: "inherit",
    cwd: __dirname + "/..",
  });
}

main()
  .catch((e) => {
    console.error("Reset failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
