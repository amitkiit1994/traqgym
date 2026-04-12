/**
 * Integration tests for lib/services/invoice.ts
 * Tests sequential invoice numbering (INV-YYYY-NNNN format).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma, disconnectDb } from "../helpers/db";
import { generateInvoice } from "@/lib/services/invoice";

let userId: number;
let workerId: number;
let planId: number;
let locationId: number;
let ticketId: number;

// Track created IDs for cleanup
const paymentIds: number[] = [];
const invoiceIds: number[] = [];
const testEmail = `__test_inv_${Date.now()}@test.local`;
const workerEmail = `__test_inv_${Date.now()}@worker.test.local`;

beforeAll(async () => {
  const location = await prisma.location.create({
    data: { name: `__test_inv_loc_${Date.now()}`, code: `TI${Date.now() % 100000}` },
  });
  locationId = location.id;

  const user = await prisma.user.create({
    data: {
      email: testEmail,
      password: "testpass",
      firstname: "Test",
      lastname: "Invoice",
    },
  });
  userId = user.id;

  const worker = await prisma.worker.create({
    data: {
      email: workerEmail,
      password: "testpass",
      firstname: "Test",
      lastname: "Worker",
      role: "staff",
    },
  });
  workerId = worker.id;

  const plan = await prisma.ticketPlan.create({
    data: { name: `__test_inv_plan_${Date.now()}`, price: 1500, expireDays: 30 },
  });
  planId = plan.id;

  const ticket = await prisma.memberTicket.create({
    data: {
      userId,
      planId,
      locationId,
      expireDate: new Date(Date.now() + 30 * 86400000),
      totalAmount: 1500,
      amountPaid: 1500,
    },
  });
  ticketId = ticket.id;
});

afterAll(async () => {
  // Delete in dependency order: invoices -> payments -> tickets -> plans/users/workers/locations
  if (invoiceIds.length) {
    await prisma.invoice.deleteMany({ where: { id: { in: invoiceIds } } });
  }
  if (paymentIds.length) {
    await prisma.payment.deleteMany({ where: { id: { in: paymentIds } } });
  }
  if (ticketId) await prisma.memberTicket.deleteMany({ where: { id: ticketId } });
  if (planId) await prisma.ticketPlan.deleteMany({ where: { id: planId } });
  if (userId) await prisma.user.deleteMany({ where: { id: userId } });
  if (workerId) await prisma.worker.deleteMany({ where: { id: workerId } });
  if (locationId) await prisma.location.deleteMany({ where: { id: locationId } });
  await disconnectDb();
});

async function createPayment() {
  const payment = await prisma.payment.create({
    data: {
      userId,
      memberTicketId: ticketId,
      locationId,
      amount: 1500,
      paymentMode: "cash",
      collectedById: workerId,
    },
  });
  paymentIds.push(payment.id);
  return payment;
}

describe("Invoice Service", () => {
  it("generates an invoice with INV-YYYY-NNNN format", async () => {
    const payment = await createPayment();

    const invoice = await prisma.$transaction(async (tx) => {
      return generateInvoice(tx, { userId, paymentId: payment.id });
    });

    invoiceIds.push(invoice.id);

    const year = new Date().getFullYear();
    expect(invoice.invoiceNumber).toMatch(new RegExp(`^INV-${year}-\\d{4}$`));
    expect(invoice.userId).toBe(userId);
    expect(invoice.paymentId).toBe(payment.id);
    expect(invoice.status).toBe("paid");
    expect(invoice.route).toBe(`/api/invoices/${invoice.id}/pdf`);
  });

  it("increments invoice numbers sequentially", async () => {
    const p1 = await createPayment();
    const p2 = await createPayment();
    const p3 = await createPayment();

    const inv1 = await prisma.$transaction((tx) =>
      generateInvoice(tx, { userId, paymentId: p1.id })
    );
    const inv2 = await prisma.$transaction((tx) =>
      generateInvoice(tx, { userId, paymentId: p2.id })
    );
    const inv3 = await prisma.$transaction((tx) =>
      generateInvoice(tx, { userId, paymentId: p3.id })
    );

    invoiceIds.push(inv1.id, inv2.id, inv3.id);

    const seq1 = parseInt(inv1.invoiceNumber.split("-")[2], 10);
    const seq2 = parseInt(inv2.invoiceNumber.split("-")[2], 10);
    const seq3 = parseInt(inv3.invoiceNumber.split("-")[2], 10);

    expect(seq2).toBe(seq1 + 1);
    expect(seq3).toBe(seq2 + 1);
  });

  it("year portion matches the current year", async () => {
    const payment = await createPayment();

    const invoice = await prisma.$transaction((tx) =>
      generateInvoice(tx, { userId, paymentId: payment.id })
    );

    invoiceIds.push(invoice.id);

    const yearPart = invoice.invoiceNumber.split("-")[1];
    expect(yearPart).toBe(String(new Date().getFullYear()));
  });

  it("pads sequence number to 4 digits", async () => {
    const payment = await createPayment();

    const invoice = await prisma.$transaction((tx) =>
      generateInvoice(tx, { userId, paymentId: payment.id })
    );

    invoiceIds.push(invoice.id);

    const seqPart = invoice.invoiceNumber.split("-")[2];
    expect(seqPart).toHaveLength(4);
  });
});
