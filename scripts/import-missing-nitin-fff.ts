/**
 * One-shot importer for Nitin's missing ₹36,000 PT payment (FFF).
 *
 * Why dropped: Nitin's "Contact No" in payments.csv:92 is "554490110" — only
 * 9 digits. Original importer at scripts/migrate-fitnessboard.ts:324 had
 * `phone.length < 10` filter that rejected him at the User step, then every
 * later join (membership, payment) failed because there was no user row.
 *
 * After this script: User + MemberTicket + Payment + Invoice exist. Owner's
 * collections / balance-due / PT reports all reconcile.
 *
 * Idempotent: skips if Invoice `FB-FFF141` already exists.
 *
 * Default mode: --dry-run. Pass --apply to write.
 *
 * Usage:
 *   DATABASE_URL=...prod-fff... npx tsx scripts/import-missing-nitin-fff.ts
 *   DATABASE_URL=...prod-fff... npx tsx scripts/import-missing-nitin-fff.ts --apply
 */

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

// CSV row 92 of payments.csv:
// "Free Form Fitness","442709","Nitin   ","2026/3/410838","554490110","","FFF141",
// "27-03-2026 00:00:00","","3 Month PT","24-03-2026 00:00:00","23-06-2026 00:00:00",
// "80000","36000","0","36000","Cash","0","MemberShip","","","27 Mar 2026 00:00:00:000","Administrator"

const NITIN = {
  firstname: "Nitin",
  lastname: "",
  phone: "554490110",
  email: "554490110@imported.local",
  fbMemberId: "442709",
  invoiceNo: "FFF141",
  planName: "3 Month PT",
  startDate: new Date("2026-03-24T00:00:00Z"),
  endDate: new Date("2026-06-23T00:00:00Z"),
  paymentDate: new Date("2026-03-27T00:00:00Z"),
  totalAmount: 80000,
  paidAmount: 36000,
  balance: 80000 - 36000,
  paymentMode: "cash",
  paymentFor: "MemberShip",
};

async function main() {
  console.log(`[import-missing-nitin-fff] mode=${APPLY ? "APPLY" : "DRY-RUN"}`);

  const fbInvoice = `FB-${NITIN.invoiceNo}`;
  const dup = await prisma.invoice.findFirst({ where: { invoiceNumber: fbInvoice } });
  if (dup) {
    console.log(`  Invoice ${fbInvoice} already exists (id=${dup.id}). Nothing to do.`);
    return;
  }

  const location = await prisma.location.findFirst({ orderBy: { id: "asc" } });
  if (!location) throw new Error("No Location row");
  const fallbackWorker = await prisma.worker.findFirst({ orderBy: { id: "asc" } });
  if (!fallbackWorker) throw new Error("No Worker row");

  const plan = await prisma.ticketPlan.findFirst({ where: { name: NITIN.planName } });
  if (!plan) throw new Error(`Plan "${NITIN.planName}" not found — create it first or rename`);

  const existingUser = await prisma.user.findFirst({ where: { OR: [{ email: NITIN.email }, { phone: NITIN.phone }] } });
  console.log(`  user lookup: ${existingUser ? `found id=${existingUser.id}` : "missing — will create"}`);
  console.log(`  plan        : ${plan.name} (id=${plan.id})`);
  console.log(`  invoice     : ${fbInvoice}  amount=${NITIN.paidAmount}  balance=${NITIN.balance}`);

  if (!APPLY) {
    console.log("\nRun with --apply to write.");
    return;
  }

  const result = await prisma.$transaction(async (tx) => {
    const user = existingUser ?? await tx.user.create({
      data: {
        email: NITIN.email,
        password: await bcrypt.hash(NITIN.phone, 10),
        firstname: NITIN.firstname,
        lastname: NITIN.lastname,
        phone: NITIN.phone,
        locationId: location.id,
        isActive: true,
        createdAt: NITIN.paymentDate,
      },
    });

    const ticket = await tx.memberTicket.create({
      data: {
        userId: user.id,
        planId: plan.id,
        locationId: location.id,
        buyDate: NITIN.startDate,
        expireDate: NITIN.endDate,
        status: "active",
        totalAmount: NITIN.totalAmount,
        amountPaid: NITIN.paidAmount,
        balanceDue: NITIN.balance,
      },
    });

    const payment = await tx.payment.create({
      data: {
        userId: user.id,
        memberTicketId: ticket.id,
        locationId: location.id,
        amount: NITIN.paidAmount,
        paymentMode: NITIN.paymentMode,
        collectedById: fallbackWorker.id,
        paymentFor: NITIN.paymentFor,
        createdAt: NITIN.paymentDate,
      },
    });

    const invoice = await tx.invoice.create({
      data: {
        invoiceNumber: fbInvoice,
        userId: user.id,
        paymentId: payment.id,
        route: "membership",
        status: "paid",
        createdAt: NITIN.paymentDate,
      },
    });

    return { userId: user.id, ticketId: ticket.id, paymentId: payment.id, invoiceId: invoice.id };
  });

  console.log("  written:", result);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
