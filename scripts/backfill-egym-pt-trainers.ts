/**
 * Backfill E-GYM PT / trainer / external-trainer data into the new fields
 * added by PR 5 (Payment.trainerId, PtPackage, Worker.isExternal).
 *
 * Reads:
 *   ./egymlokhandwala-data-export/FINAL_payments_all.csv  (Trainer + InvoiceNo)
 *   ./egymlokhandwala-data-export/FINAL_packages.csv      (Sessions per plan)
 *
 * Writes (idempotently):
 *   - Worker.isExternal=true for trainers whose CSV name contains "External Trainer"
 *   - Payment.trainerId set by matching invoiceNumber FB-{InvoiceNo} → Invoice.paymentId
 *   - PtPackage rows for payments on PT plans (plan name/category contains PT/OPT/Personal Training)
 *
 * Usage: DATABASE_URL=... npx tsx scripts/backfill-egym-pt-trainers.ts
 * Safe to re-run.
 */

import { PrismaClient } from "@prisma/client";
import { parse } from "csv-parse/sync";
import fs from "fs";
import path from "path";

const prisma = new PrismaClient();
// Try worktree-local path first, then fall back to main repo location.
const CSV_DIR = (() => {
  const candidates = [
    path.resolve(__dirname, "../egymlokhandwala-data-export"),
    path.resolve(__dirname, "../../egymlokhandwala-data-export"),
    "/Users/amitkumardas/freeformOS/freeformfitnessOS/egymlokhandwala-data-export",
  ];
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, "FINAL_payments_all.csv"))) return c;
  }
  throw new Error(
    "egymlokhandwala-data-export not found in any of: " + candidates.join(", ")
  );
})();

type Row = Record<string, string>;

function readCsv(filename: string): Row[] {
  const content = fs.readFileSync(path.join(CSV_DIR, filename), "utf-8");
  return parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
  });
}

/** Strip "External Trainer", "In House Trainer", "Floor Trainer(s)" etc. */
function stripTrainerSuffix(raw: string): { name: string; isExternal: boolean } {
  let s = raw.trim();
  const isExternal = /external\s*trainer|outside\s*trainer/i.test(s);
  s = s
    .replace(/\bexternal\s*trainer\b/gi, "")
    .replace(/\bin\s*house\s*trainer\b/gi, "")
    .replace(/\bin\s*house\s*personal\s*trainer\b/gi, "")
    .replace(/\binhouse\s*trainer\b/gi, "")
    .replace(/\boutside\s*trainer\b/gi, "")
    .replace(/\bfloor\s*trainers?\b/gi, "")
    .replace(/\bin\s*hous\s*trainer\b/gi, "") // typo in Worker table: "Omkar.in.hous.trainer"
    .replace(/[._]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return { name: s, isExternal };
}

function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .replace(/\(.*?\)/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const SKIP_TRAINERS = new Set([
  "",
  "administrator",
  "floor trainer",
  "floor trainers",
]);

async function main() {
  console.log("Reading CSVs from:", CSV_DIR);
  const payments = readCsv("FINAL_payments_all.csv");
  const packages = readCsv("FINAL_packages.csv");
  console.log(`  Payments: ${payments.length}, Packages: ${packages.length}`);

  // ── 1. Build trainer name → Worker map ──────────────────────────────────────
  const workers = await prisma.worker.findMany({
    select: { id: true, firstname: true, lastname: true, isExternal: true },
  });
  const workerByNorm = new Map<string, number>();
  // Also collect workers whose stored name implies they're external (so we can
  // flag isExternal even when the CSV doesn't carry the suffix on every row).
  const workersExternalFromName = new Set<number>();
  for (const w of workers) {
    const fullRaw = `${w.firstname ?? ""} ${w.lastname ?? ""}`.trim();
    const stripped = stripTrainerSuffix(fullRaw);
    if (stripped.isExternal) workersExternalFromName.add(w.id);
    const norm = normalizeName(stripped.name);
    if (norm && !workerByNorm.has(norm)) workerByNorm.set(norm, w.id);
    // Also index by raw full name (covers cases the suffix-strip didn't help).
    const rawNorm = normalizeName(fullRaw);
    if (rawNorm && !workerByNorm.has(rawNorm)) workerByNorm.set(rawNorm, w.id);
    // First-name-only fallback (CSV often uses first name only).
    const firstNorm = normalizeName(w.firstname ?? "");
    if (firstNorm && !workerByNorm.has(firstNorm)) workerByNorm.set(firstNorm, w.id);
  }
  console.log(`  Workers indexed: ${workerByNorm.size} unique keys for ${workers.length} workers`);
  console.log(`  Workers external-by-name: ${workersExternalFromName.size}`);

  // ── 2. Aggregate trainer signals from payments (name → isExternal) ─────────
  type TrainerStat = { workerId: number | null; isExternal: boolean; count: number };
  const trainerStats = new Map<string, TrainerStat>();
  for (const row of payments) {
    const raw = row["Trainer"]?.trim() ?? "";
    if (!raw) continue;
    const { name, isExternal } = stripTrainerSuffix(raw);
    const norm = normalizeName(name);
    if (SKIP_TRAINERS.has(norm)) continue;
    const workerId = workerByNorm.get(norm) ?? null;
    const cur = trainerStats.get(norm) ?? { workerId, isExternal: false, count: 0 };
    cur.count += 1;
    if (isExternal) cur.isExternal = true;
    trainerStats.set(norm, cur);
  }
  console.log(`  Distinct trainer names from payments: ${trainerStats.size}`);
  const matched = Array.from(trainerStats.values()).filter((t) => t.workerId !== null).length;
  console.log(`  Matched to Worker rows: ${matched}`);

  // ── 3. Update Worker.isExternal ────────────────────────────────────────────
  // Combine signal from CSV (trainer suffix) AND Worker.name suffix.
  const externalWorkerIds = new Set<number>(workersExternalFromName);
  for (const stat of trainerStats.values()) {
    if (stat.workerId && stat.isExternal) externalWorkerIds.add(stat.workerId);
  }
  let externalSet = 0;
  for (const wid of externalWorkerIds) {
    const w = await prisma.worker.findUnique({
      where: { id: wid },
      select: { isExternal: true },
    });
    if (w?.isExternal) continue;
    await prisma.worker.update({ where: { id: wid }, data: { isExternal: true } });
    externalSet += 1;
  }
  console.log(`  Workers flagged isExternal=true: ${externalSet}`);

  // ── 4. Build plan name → { sessions, isPt } map from packages.csv ──────────
  const planMeta = new Map<string, { sessions: number; isPt: boolean }>();
  for (const row of packages) {
    const name = row["Membership Name"]?.trim() ?? "";
    if (!name) continue;
    const cat = (row["Membership Category"] ?? "").toLowerCase();
    const sessionsRaw = row["Sessions"] ?? "0";
    const sessions = parseInt(sessionsRaw, 10) || 0;
    const isPt =
      /personal training|opt/.test(cat) ||
      /\bpt\b|opt|personal/i.test(name);
    planMeta.set(name.toLowerCase(), { sessions, isPt });
  }
  const ptPlanCount = Array.from(planMeta.values()).filter((p) => p.isPt).length;
  console.log(`  Plans flagged as PT: ${ptPlanCount}/${planMeta.size}`);

  // Build TicketPlan name → id (lowercased) for DB lookup
  const dbPlans = await prisma.ticketPlan.findMany({
    select: { id: true, name: true },
  });
  const planByName = new Map<string, number>();
  for (const p of dbPlans) planByName.set(p.name.trim().toLowerCase(), p.id);

  // ── 5. Iterate payments, set Payment.trainerId, optionally create PtPackage ─
  let trainerSet = 0;
  let trainerSkipNoMatch = 0;
  let ptPackageCreated = 0;
  let ptPackageSkipExisting = 0;
  let processed = 0;

  for (const row of payments) {
    processed += 1;
    if (processed % 1000 === 0) {
      console.log(`  ... processed ${processed}/${payments.length}`);
    }

    const invoiceNo = row["InvoiceNo"]?.trim();
    if (!invoiceNo) continue;

    const trainerRaw = row["Trainer"]?.trim() ?? "";
    if (!trainerRaw) continue;

    const { name } = stripTrainerSuffix(trainerRaw);
    const norm = normalizeName(name);
    if (SKIP_TRAINERS.has(norm)) continue;

    const stat = trainerStats.get(norm);
    if (!stat?.workerId) {
      trainerSkipNoMatch += 1;
      continue;
    }

    // Find the Payment via the imported Invoice (FB-prefixed invoice numbers)
    const invoice = await prisma.invoice.findFirst({
      where: { invoiceNumber: `EGL-${invoiceNo}` },
      select: { paymentId: true },
    });
    if (!invoice?.paymentId) continue;

    const payment = await prisma.payment.findUnique({
      where: { id: invoice.paymentId },
      select: {
        id: true,
        userId: true,
        memberTicketId: true,
        amount: true,
        trainerId: true,
        createdAt: true,
      },
    });
    if (!payment) continue;

    if (!payment.trainerId) {
      await prisma.payment.update({
        where: { id: payment.id },
        data: { trainerId: stat.workerId },
      });
      trainerSet += 1;
    }

    // PT package creation
    const planNameLc = (row["MembershipName"] ?? "").trim().toLowerCase();
    if (!planNameLc) continue;
    const meta = planMeta.get(planNameLc);
    if (!meta?.isPt) continue;

    const existing = await prisma.ptPackage.findFirst({
      where: { paymentId: payment.id },
      select: { id: true },
    });
    if (existing) {
      ptPackageSkipExisting += 1;
      continue;
    }

    // PtPackage.userId is required; Payment.userId became nullable for POS
     // sales. PT-tagged payments are always member-bound, but skip defensively.
    if (payment.userId === null) continue;

    const sessionsTotal = meta.sessions > 0 ? meta.sessions : 12;
    const totalPrice = Number(payment.amount);
    const pricePerSession =
      sessionsTotal > 0 ? totalPrice / sessionsTotal : totalPrice;

    // Use the historic payment date as the package start, not "now()".
    // EGYM's payments date back years — defaulting to today would make every
    // package look freshly issued and skew Trainer/PT analytics.
    const historicStartedAt = payment.createdAt;

    await prisma.ptPackage.create({
      data: {
        userId: payment.userId,
        trainerId: stat.workerId,
        paymentId: payment.id,
        sessionsTotal,
        sessionsUsed: 0,
        pricePerSession: pricePerSession.toFixed(2),
        totalPrice: totalPrice.toFixed(2),
        status: "active",
        startedAt: historicStartedAt,
      },
    });
    ptPackageCreated += 1;
  }

  // ── 6. Worker dedup pass ────────────────────────────────────────────────────
  // EGYM imports created multiple Worker rows for the same human (e.g.
  // "Akhil", "Akhil External Trainer", "Akhil.in.hous.trainer"). Pick the
  // canonical row (most-complete name + isActive preferred), repoint
  // PtPackage.trainerId / Payment.trainerId / TrainerPayout.trainerId, and
  // deactivate the duplicates.
  console.log(`\n── Worker dedup ──`);
  const allWorkers = await prisma.worker.findMany({
    select: {
      id: true,
      firstname: true,
      lastname: true,
      isActive: true,
      isExternal: true,
    },
  });

  // Group workers by stripped+normalized name.
  const groups = new Map<string, typeof allWorkers>();
  for (const w of allWorkers) {
    const fullRaw = `${w.firstname ?? ""} ${w.lastname ?? ""}`.trim();
    const stripped = stripTrainerSuffix(fullRaw).name;
    const norm = normalizeName(stripped);
    if (!norm) continue;
    if (!groups.has(norm)) groups.set(norm, []);
    groups.get(norm)!.push(w);
  }

  let mergedGroups = 0;
  let workersDeactivated = 0;
  let ptPackagesRepointed = 0;
  let paymentsRepointed = 0;
  let payoutsRepointed = 0;

  for (const [norm, members] of groups) {
    if (members.length < 2) continue;
    // Score: prefer active, then row with both first+last name, then lowest id.
    const ranked = members.slice().sort((a, b) => {
      const aScore =
        (a.isActive ? 1000 : 0) +
        ((a.firstname?.length ?? 0) > 0 ? 50 : 0) +
        ((a.lastname?.length ?? 0) > 0 ? 50 : 0);
      const bScore =
        (b.isActive ? 1000 : 0) +
        ((b.firstname?.length ?? 0) > 0 ? 50 : 0) +
        ((b.lastname?.length ?? 0) > 0 ? 50 : 0);
      if (bScore !== aScore) return bScore - aScore;
      return a.id - b.id;
    });
    const canonical = ranked[0];
    const dupes = ranked.slice(1);

    // Repoint references and deactivate dupes — atomic per group so a partial
    // failure doesn't leave half-merged rows.
    await prisma.$transaction(async (tx) => {
      for (const d of dupes) {
        const pp = await tx.ptPackage.updateMany({
          where: { trainerId: d.id },
          data: { trainerId: canonical.id },
        });
        ptPackagesRepointed += pp.count;
        const pay = await tx.payment.updateMany({
          where: { trainerId: d.id },
          data: { trainerId: canonical.id },
        });
        paymentsRepointed += pay.count;
        const po = await tx.trainerPayout.updateMany({
          where: { trainerId: d.id },
          data: { trainerId: canonical.id },
        });
        payoutsRepointed += po.count;
        // Deactivate (don't delete — preserves audit trail).
        if (d.isActive) {
          await tx.worker.update({
            where: { id: d.id },
            data: { isActive: false },
          });
          workersDeactivated += 1;
        }
      }
    });

    mergedGroups += 1;
    console.log(
      `  ${norm}: kept #${canonical.id} (${canonical.firstname} ${canonical.lastname}), merged ${dupes.length} dupe(s)`
    );
  }

  console.log(`\nDedup summary:`);
  console.log(`  Groups merged: ${mergedGroups}`);
  console.log(`  Workers deactivated: ${workersDeactivated}`);
  console.log(`  PtPackage repointed: ${ptPackagesRepointed}`);
  console.log(`  Payment repointed: ${paymentsRepointed}`);
  console.log(`  TrainerPayout repointed: ${payoutsRepointed}`);

  console.log(`\n── Summary ──`);
  console.log(`  Payments updated with trainerId: ${trainerSet}`);
  console.log(`  Payments skipped (no Worker match): ${trainerSkipNoMatch}`);
  console.log(`  PtPackage rows created: ${ptPackageCreated}`);
  console.log(`  PtPackage rows already existed: ${ptPackageSkipExisting}`);
  console.log(`  Workers flagged isExternal: ${externalSet}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
