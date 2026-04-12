/**
 * Integration tests for lib/services/partial-payment.ts — recordPartialPayment()
 *
 * These tests call the service function directly (no auth context required).
 * Test data is created via the test prisma client and cleaned up in afterAll.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma, disconnectDb } from "../helpers/db";
import { recordPartialPayment } from "@/lib/services/partial-payment";

// Track IDs for cleanup
const cleanup = {
  userIds: [] as number[],
  workerIds: [] as number[],
  planIds: [] as number[],
  locationIds: [] as number[],
  ticketIds: [] as number[],
  paymentIds: [] as number[],
  auditLogIds: [] as number[],
};

let user: { id: number };
let worker: { id: number };
let plan: { id: number };
let location: { id: number };

beforeAll(async () => {
  const uid = `__test_${Date.now()}`;

  user = await prisma.user.create({
    data: {
      firstname: "Partial",
      lastname: "PayUser",
      email: `${uid}@test.local`,
      phone: "9000000002",
      password: "$2b$10$fakehashfortesting000000000000000000000000000",
    },
  });
  cleanup.userIds.push(user.id);

  worker = await prisma.worker.create({
    data: {
      firstname: "Partial",
      lastname: "PayWorker",
      email: `${uid}@worker.test.local`,
      password: "$2b$10$fakehashfortesting000000000000000000000000000",
      role: "staff",
    },
  });
  cleanup.workerIds.push(worker.id);

  plan = await prisma.ticketPlan.create({
    data: {
      name: `Test Plan Partial ${uid}`,
      price: 3000,
      expireDays: 30,
      isActive: true,
    },
  });
  cleanup.planIds.push(plan.id);

  location = await prisma.location.create({
    data: {
      name: `Test Location Partial ${uid}`,
      code: uid.slice(-8).toUpperCase(),
      isActive: true,
    },
  });
  cleanup.locationIds.push(location.id);
});

afterAll(async () => {
  // Cleanup audit logs created by partial_payment action for this worker
  const logs = await prisma.auditLog.findMany({
    where: { action: "partial_payment", actorId: worker.id },
    select: { id: true },
  });
  const logIds = logs.map((l) => l.id);
  if (logIds.length)
    await prisma.auditLog.deleteMany({ where: { id: { in: logIds } } });

  if (cleanup.paymentIds.length)
    await prisma.payment.deleteMany({ where: { id: { in: cleanup.paymentIds } } });
  if (cleanup.ticketIds.length)
    await prisma.memberTicket.deleteMany({ where: { id: { in: cleanup.ticketIds } } });
  if (cleanup.planIds.length)
    await prisma.ticketPlan.deleteMany({ where: { id: { in: cleanup.planIds } } });
  if (cleanup.locationIds.length)
    await prisma.location.deleteMany({ where: { id: { in: cleanup.locationIds } } });
  if (cleanup.workerIds.length)
    await prisma.worker.deleteMany({ where: { id: { in: cleanup.workerIds } } });
  if (cleanup.userIds.length)
    await prisma.user.deleteMany({ where: { id: { in: cleanup.userIds } } });
  await disconnectDb();
});

/**
 * Create a ticket with a balance due for partial payment tests.
 */
async function createTicketWithBalance(totalAmount: number, amountPaid: number) {
  const ticket = await prisma.memberTicket.create({
    data: {
      userId: user.id,
      planId: plan.id,
      locationId: location.id,
      buyDate: new Date(),
      expireDate: new Date(Date.now() + 30 * 86400000),
      status: "active",
      totalAmount,
      amountPaid,
      balanceDue: totalAmount - amountPaid,
    },
  });
  cleanup.ticketIds.push(ticket.id);
  return ticket;
}

describe("recordPartialPayment", () => {
  it("reduces balance due after a single partial payment", async () => {
    const ticket = await createTicketWithBalance(3000, 1000);
    // balanceDue = 2000

    const result = await recordPartialPayment({
      ticketId: ticket.id,
      amount: 500,
      paymentMode: "cash",
      collectedById: worker.id,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;

    cleanup.paymentIds.push(result.paymentId);

    expect(result.newBalanceDue).toBe(1500);
    expect(result.isFullyPaid).toBe(false);

    // Verify DB state (Decimal fields need Number() for comparison)
    const updated = await prisma.memberTicket.findUnique({ where: { id: ticket.id } });
    expect(Number(updated!.amountPaid)).toBe(1500);
    expect(Number(updated!.balanceDue)).toBe(1500);
  });

  it("multiple partials summing to full amount results in zero balance", async () => {
    const ticket = await createTicketWithBalance(3000, 1000);
    // balanceDue = 2000

    // First partial: 800
    const r1 = await recordPartialPayment({
      ticketId: ticket.id,
      amount: 800,
      paymentMode: "cash",
      collectedById: worker.id,
    });
    expect(r1.success).toBe(true);
    if (r1.success) cleanup.paymentIds.push(r1.paymentId);

    // Second partial: 700
    const r2 = await recordPartialPayment({
      ticketId: ticket.id,
      amount: 700,
      paymentMode: "upi",
      upiReference: "UPI123456",
      collectedById: worker.id,
    });
    expect(r2.success).toBe(true);
    if (r2.success) cleanup.paymentIds.push(r2.paymentId);

    // Third partial: remaining 500
    const r3 = await recordPartialPayment({
      ticketId: ticket.id,
      amount: 500,
      paymentMode: "cash",
      collectedById: worker.id,
    });
    expect(r3.success).toBe(true);
    if (r3.success) cleanup.paymentIds.push(r3.paymentId);

    expect(r3.success && r3.newBalanceDue).toBe(0);
    expect(r3.success && r3.isFullyPaid).toBe(true);

    // Verify DB (Decimal fields need Number() for comparison)
    const updated = await prisma.memberTicket.findUnique({ where: { id: ticket.id } });
    expect(Number(updated!.balanceDue)).toBe(0);
    expect(Number(updated!.amountPaid)).toBe(3000);
  });

  it("paying exact remaining balance marks ticket as fully paid", async () => {
    const ticket = await createTicketWithBalance(3000, 2000);
    // balanceDue = 1000

    const result = await recordPartialPayment({
      ticketId: ticket.id,
      amount: 1000,
      paymentMode: "cash",
      collectedById: worker.id,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;

    cleanup.paymentIds.push(result.paymentId);

    expect(result.newBalanceDue).toBe(0);
    expect(result.isFullyPaid).toBe(true);

    // Verify payment status is "full" when balance hits zero
    const payment = await prisma.payment.findUnique({ where: { id: result.paymentId } });
    expect(payment!.paymentStatus).toBe("full");
  });

  it("rejects zero amount", async () => {
    const ticket = await createTicketWithBalance(3000, 1000);

    const result = await recordPartialPayment({
      ticketId: ticket.id,
      amount: 0,
      paymentMode: "cash",
      collectedById: worker.id,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("Amount must be positive");
  });

  it("rejects negative amount", async () => {
    const ticket = await createTicketWithBalance(3000, 1000);

    const result = await recordPartialPayment({
      ticketId: ticket.id,
      amount: -500,
      paymentMode: "cash",
      collectedById: worker.id,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("Amount must be positive");
  });

  it("rejects amount exceeding balance due", async () => {
    const ticket = await createTicketWithBalance(3000, 2500);
    // balanceDue = 500

    const result = await recordPartialPayment({
      ticketId: ticket.id,
      amount: 600,
      paymentMode: "cash",
      collectedById: worker.id,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Amount exceeds balance due");
  });

  it("rejects payment on a ticket with no balance due", async () => {
    const ticket = await createTicketWithBalance(3000, 3000);
    // balanceDue = 0

    const result = await recordPartialPayment({
      ticketId: ticket.id,
      amount: 100,
      paymentMode: "cash",
      collectedById: worker.id,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("No balance due on this ticket");
  });

  it("rejects payment on a non-existent ticket", async () => {
    const result = await recordPartialPayment({
      ticketId: 999999,
      amount: 500,
      paymentMode: "cash",
      collectedById: worker.id,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("Ticket not found");
  });
});
