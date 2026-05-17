/**
 * Mark any open Enquiry as 'converted' when a User with the same phone
 * already exists. Fixes the data-quality issue where the original v3
 * migration created both an Enquiry and a User for each existing member,
 * but never linked the Enquiry to the conversion.
 *
 * Symptom: AI's member-lookup sometimes finds an "enquiry" first and
 * incorrectly tells the user the person is a prospect, not a member.
 *
 * Idempotent — safe to re-run.
 *
 * Usage: npx tsx scripts/mark-converted-enquiries.ts            # dry-run
 *        npx tsx scripts/mark-converted-enquiries.ts --apply    # actually update
 */
import { prisma } from "@/lib/prisma";

const APPLY = process.argv.includes("--apply");

async function main() {
  console.log(`Mode: ${APPLY ? "APPLY" : "DRY-RUN"}`);

  // All non-converted enquiries with a phone
  const openEnq = await prisma.enquiry.findMany({
    where: {
      phone: { not: "" },
      status: { notIn: ["converted", "lost", "dropped", "rejected"] },
    },
    select: { id: true, name: true, phone: true, status: true },
  });
  console.log(`Open enquiries with phone: ${openEnq.length}`);

  // Build a set of phones that exist as Users (normalised to last-10-digits)
  const users = await prisma.user.findMany({ select: { phone: true } });
  const userPhones = new Set(
    users
      .filter((u): u is { phone: string } => !!u.phone)
      .map((u) => u.phone.replace(/\D/g, "").slice(-10))
      .filter((p) => p.length === 10),
  );
  console.log(`Distinct user phones: ${userPhones.size}`);

  const toConvert = openEnq.filter((e) => {
    const norm = e.phone.replace(/\D/g, "").slice(-10);
    return norm.length === 10 && userPhones.has(norm);
  });
  console.log(`Enquiries with matching user phone: ${toConvert.length}`);

  if (toConvert.length === 0) {
    console.log("Nothing to do.");
    return;
  }

  if (!APPLY) {
    console.log("Sample of what would be converted:");
    for (const e of toConvert.slice(0, 10)) {
      console.log(`  id=${e.id} ${e.name.padEnd(30)} ${e.phone} status=${e.status}`);
    }
    console.log(`\nRe-run with --apply to mark all ${toConvert.length} as converted.`);
    return;
  }

  const result = await prisma.enquiry.updateMany({
    where: { id: { in: toConvert.map((e) => e.id) } },
    data: { status: "converted" },
  });
  console.log(`Converted ${result.count} enquiries to status='converted'`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => process.exit(0));
