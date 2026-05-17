/**
 * One-shot: read freeform's local v3 payment CSV and back-fill Payment.trainerId
 * on existing FB-* invoices where the payment has trainerId=null AND the v3
 * row had a Trainer string we can resolve to a Worker.
 *
 * Usage:
 *   DATABASE_URL=... npx tsx /tmp/backfill-trainer.ts <path-to-payment-csv>
 */
import fs from "node:fs";
import { parse } from "csv-parse/sync";
import { prisma } from "@/lib/prisma";

async function main() {
  const csvPath = process.argv[2];
  if (!csvPath) {
    console.error("Usage: backfill-trainer.ts <path-to-payment-csv>");
    process.exit(1);
  }
  const raw = fs.readFileSync(csvPath, "utf-8");
  const rows = parse(raw, { columns: true, skip_empty_lines: true, trim: true }) as Record<string, string>[];
  console.log(`Loaded ${rows.length} v3 payment rows from ${csvPath}`);

  let updated = 0;
  let noInvoice = 0;
  let alreadySet = 0;
  let noTrainerStr = 0;
  let trainerNotInWorkers = 0;
  const unmatchedTrainerNames = new Map<string, number>();

  for (const r of rows) {
    const billNo = (r["Bill No"] ?? r.BillNo ?? "").trim();
    if (!billNo) continue;
    const invoice = await prisma.invoice.findFirst({
      where: { invoiceNumber: `FB-${billNo}` },
      select: { payment: { select: { id: true, trainerId: true } } },
    });
    if (!invoice?.payment) { noInvoice++; continue; }
    if (invoice.payment.trainerId != null) { alreadySet++; continue; }

    const trainerName = (r.Trainer ?? "").trim();
    if (!trainerName) { noTrainerStr++; continue; }

    const tokens = trainerName.split(/\s+/).filter(Boolean);
    const worker = await prisma.worker.findFirst({
      where: {
        isActive: true,
        AND: tokens.map((t) => ({
          OR: [
            { firstname: { equals: t, mode: "insensitive" as const } },
            { lastname: { equals: t, mode: "insensitive" as const } },
            { firstname: { contains: t, mode: "insensitive" as const } },
            { lastname: { contains: t, mode: "insensitive" as const } },
          ],
        })),
      },
      select: { id: true },
    });

    if (!worker) {
      trainerNotInWorkers++;
      unmatchedTrainerNames.set(trainerName, (unmatchedTrainerNames.get(trainerName) ?? 0) + 1);
      continue;
    }

    await prisma.payment.update({
      where: { id: invoice.payment.id },
      data: { trainerId: worker.id },
    });
    updated++;
  }

  console.log(`\nUpdated: ${updated}`);
  console.log(`Already had trainerId: ${alreadySet}`);
  console.log(`No matching invoice: ${noInvoice}`);
  console.log(`No trainer string in v3 row: ${noTrainerStr}`);
  console.log(`Trainer string didn't match any Worker: ${trainerNotInWorkers}`);
  if (unmatchedTrainerNames.size > 0) {
    console.log("Unmatched trainer names (count):");
    for (const [n, c] of unmatchedTrainerNames) console.log(`  '${n}': ${c}`);
  }
  await prisma.$disconnect();
}

main().catch((err) => { console.error(err); process.exit(1); });
