/**
 * Integration tests for lib/services/payment-schedule.ts
 *
 * Covers:
 *  - createSchedule sum-vs-totalAmount assertion (T06 from D9)
 *  - createSchedule happy path
 *  - recordInstallmentPayment idempotency under concurrent writes
 *    (verifies the R02 hardening: reads moved INSIDE the txn + conditional
 *    updateMany on installment.paidAmount)
 *  - installment status transitions (paid / pending)
 *  - schedule status flips to "completed" when all installments paid
 *
 * Tests call the service functions directly. Test data is created via the
 * test prisma client and cleaned up in afterEach to keep tests isolated.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { prisma, disconnectDb } from "../helpers/db";
import {
  createSchedule,
  recordInstallmentPayment,
} from "@/lib/services/payment-schedule";

// Per-suite fixtures (user / worker / plan / location) — created once.
let user: { id: number };
let worker: { id: number };
let plan: { id: number };
let location: { id: number };

// Per-test cleanup — populated as each test creates rows.
const created = {
  ticketIds: [] as number[],
  scheduleIds: [] as number[],
  installmentIds: [] as number[],
  paymentIds: [] as number[],
};

const SUITE_UID = `__test_psched_${Date.now()}`;

beforeAll(async () => {
  user = await prisma.user.create({
    data: {
      firstname: "Schedule",
      lastname: "TestUser",
      email: `${SUITE_UID}@test.local`,
      phone: "9000000901",
      password: "$2b$10$fakehashfortesting000000000000000000000000000",
    },
  });

  worker = await prisma.worker.create({
    data: {
      firstname: "Schedule",
      lastname: "TestWorker",
      email: `${SUITE_UID}@worker.test.local`,
      password: "$2b$10$fakehashfortesting000000000000000000000000000",
      role: "staff",
    },
  });

  plan = await prisma.ticketPlan.create({
    data: {
      name: `Test Plan PSched ${SUITE_UID}`,
      price: 12000,
      expireDays: 90,
      isActive: true,
    },
  });

  location = await prisma.location.create({
    data: {
      name: `Test Location PSched ${SUITE_UID}`,
      code: `PS${SUITE_UID.slice(-6).toUpperCase()}`,
      isActive: true,
    },
  });
});

afterEach(async () => {
  // Order matters: payments reference installments via paymentId; installments
  // reference schedules; schedules reference tickets. Audit logs are loose.
  if (created.installmentIds.length) {
    await prisma.paymentInstallment.deleteMany({
      where: { id: { in: created.installmentIds } },
    });
    created.installmentIds.length = 0;
  }
  if (created.paymentIds.length) {
    await prisma.payment.deleteMany({
      where: { id: { in: created.paymentIds } },
    });
    created.paymentIds.length = 0;
  }
  if (created.scheduleIds.length) {
    await prisma.paymentSchedule.deleteMany({
      where: { id: { in: created.scheduleIds } },
    });
    created.scheduleIds.length = 0;
  }
  if (created.ticketIds.length) {
    await prisma.memberTicket.deleteMany({
      where: { id: { in: created.ticketIds } },
    });
    created.ticketIds.length = 0;
  }

  // Clean up audit log rows produced by this worker's activity in this test.
  await prisma.auditLog.deleteMany({
    where: {
      actorId: worker.id,
      action: { in: ["payment_schedule_create", "installment_payment"] },
    },
  });
});

afterAll(async () => {
  await prisma.ticketPlan.deleteMany({ where: { id: plan.id } });
  await prisma.location.deleteMany({ where: { id: location.id } });
  await prisma.worker.deleteMany({ where: { id: worker.id } });
  await prisma.user.deleteMany({ where: { id: user.id } });
  await disconnectDb();
});

/**
 * Create a member ticket with a totalAmount + balanceDue ready for scheduling.
 */
async function createTicket(totalAmount: number) {
  const ticket = await prisma.memberTicket.create({
    data: {
      userId: user.id,
      planId: plan.id,
      locationId: location.id,
      buyDate: new Date(),
      expireDate: new Date(Date.now() + 90 * 86400000),
      status: "active",
      totalAmount,
      amountPaid: 0,
      balanceDue: totalAmount,
    },
  });
  created.ticketIds.push(ticket.id);
  return ticket;
}

/**
 * Create a schedule via the service and capture IDs for cleanup.
 */
async function createScheduleForCleanup(
  ticketId: number,
  installments: Array<{ dueDate: Date; amount: number }>
) {
  const r = await createSchedule({
    memberTicketId: ticketId,
    installments,
    createdById: worker.id,
  });
  if (!r.success) throw new Error(`createSchedule failed: ${r.error}`);
  created.scheduleIds.push(r.scheduleId);
  const inst = await prisma.paymentInstallment.findMany({
    where: { scheduleId: r.scheduleId },
    orderBy: { sequenceNumber: "asc" },
  });
  for (const i of inst) created.installmentIds.push(i.id);
  return { scheduleId: r.scheduleId, installments: inst };
}

describe("createSchedule", () => {
  it("createSchedule asserts sum(installments.amount) === totalAmount", async () => {
    const ticket = await createTicket(10000);

    const day = 86400000;
    const r = await createSchedule({
      memberTicketId: ticket.id,
      installments: [
        { dueDate: new Date(Date.now() + 7 * day), amount: 4000 },
        { dueDate: new Date(Date.now() + 30 * day), amount: 3000 },
        // Sum = 7000, ticket totalAmount = 10000 → must reject.
      ],
      createdById: worker.id,
    });

    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error).toMatch(/Sum of installments/);
    expect(r.error).toMatch(/10000/);

    // Confirm no schedule was persisted.
    const sched = await prisma.paymentSchedule.findUnique({
      where: { memberTicketId: ticket.id },
    });
    expect(sched).toBeNull();
  });

  it("createSchedule succeeds when sum matches", async () => {
    const ticket = await createTicket(10000);

    const day = 86400000;
    const { scheduleId, installments } = await createScheduleForCleanup(
      ticket.id,
      [
        { dueDate: new Date(Date.now() + 7 * day), amount: 4000 },
        { dueDate: new Date(Date.now() + 30 * day), amount: 3000 },
        { dueDate: new Date(Date.now() + 60 * day), amount: 3000 },
      ]
    );

    expect(scheduleId).toBeGreaterThan(0);
    expect(installments).toHaveLength(3);
    // Sequence numbers assigned in due-date order.
    expect(installments.map((i) => i.sequenceNumber)).toEqual([1, 2, 3]);
    // Sum of installment.amount === schedule.totalAmount === ticket.totalAmount
    const sum = installments.reduce((s, i) => s + Number(i.amount), 0);
    expect(sum).toBe(10000);
    const sched = await prisma.paymentSchedule.findUnique({
      where: { id: scheduleId },
    });
    expect(Number(sched!.totalAmount)).toBe(10000);
    expect(sched!.status).toBe("active");
  });
});

describe("recordInstallmentPayment", () => {
  it("recordInstallmentPayment is idempotent — concurrent payments don't double-credit", async () => {
    const ticket = await createTicket(10000);
    const day = 86400000;
    const { installments } = await createScheduleForCleanup(ticket.id, [
      { dueDate: new Date(Date.now() + 7 * day), amount: 4000 },
      { dueDate: new Date(Date.now() + 30 * day), amount: 3000 },
      { dueDate: new Date(Date.now() + 60 * day), amount: 3000 },
    ]);

    const target = installments[0]; // amount = 4000
    expect(Number(target.amount)).toBe(4000);

    // Fire two simultaneous full-installment payments for the SAME installment.
    // The hardening (compare-and-set on installment.paidAmount + relative
    // decrement on ticket.balanceDue inside a single txn) must allow exactly
    // one to succeed.
    const [r1, r2] = await Promise.all([
      recordInstallmentPayment({
        installmentId: target.id,
        paidAmount: 4000,
        paymentMode: "cash",
        collectedById: worker.id,
      }),
      recordInstallmentPayment({
        installmentId: target.id,
        paidAmount: 4000,
        paymentMode: "cash",
        collectedById: worker.id,
      }),
    ]);

    for (const r of [r1, r2]) {
      if (r.success) created.paymentIds.push(r.paymentId);
    }

    // Exactly one succeeds; the loser is rejected (either by the compare-and-set
    // or the "already paid" guard, depending on interleaving).
    const successes = [r1, r2].filter((r) => r.success);
    const failures = [r1, r2].filter((r) => !r.success);
    expect(successes.length).toBe(1);
    expect(failures.length).toBe(1);

    // Installment is paid exactly once (paidAmount === amount, not 2x).
    const finalInst = await prisma.paymentInstallment.findUnique({
      where: { id: target.id },
    });
    expect(Number(finalInst!.paidAmount)).toBe(4000);
    expect(finalInst!.status).toBe("paid");

    // Ticket balanceDue debited by 4000 once (10000 → 6000), not twice.
    const finalTicket = await prisma.memberTicket.findUnique({
      where: { id: ticket.id },
    });
    expect(Number(finalTicket!.amountPaid)).toBe(4000);
    expect(Number(finalTicket!.balanceDue)).toBe(6000);

    // Only one payment row was persisted for this installment.
    const payments = await prisma.payment.findMany({
      where: {
        memberTicketId: ticket.id,
        paymentFor: "installment",
      },
    });
    expect(payments.length).toBe(1);
    // Make sure cleanup tracks every row we ended up creating, including any
    // payment that may have been written before a losing txn rolled back.
    for (const p of payments) {
      if (!created.paymentIds.includes(p.id)) created.paymentIds.push(p.id);
    }
  });

  it("installment status flips to 'paid' when paidAmount === amount", async () => {
    const ticket = await createTicket(6000);
    const day = 86400000;
    const { installments } = await createScheduleForCleanup(ticket.id, [
      { dueDate: new Date(Date.now() + 7 * day), amount: 3000 },
      { dueDate: new Date(Date.now() + 30 * day), amount: 3000 },
    ]);
    const target = installments[0];

    const r = await recordInstallmentPayment({
      installmentId: target.id,
      paidAmount: 3000,
      paymentMode: "cash",
      collectedById: worker.id,
    });
    expect(r.success).toBe(true);
    if (!r.success) return;
    created.paymentIds.push(r.paymentId);
    expect(r.isFullyPaid).toBe(true);

    const inst = await prisma.paymentInstallment.findUnique({
      where: { id: target.id },
    });
    expect(inst!.status).toBe("paid");
    expect(Number(inst!.paidAmount)).toBe(3000);
    expect(inst!.paidAt).not.toBeNull();
  });

  it("installment status remains 'pending' if only partially paid", async () => {
    const ticket = await createTicket(6000);
    const day = 86400000;
    const { installments } = await createScheduleForCleanup(ticket.id, [
      { dueDate: new Date(Date.now() + 7 * day), amount: 3000 },
      { dueDate: new Date(Date.now() + 30 * day), amount: 3000 },
    ]);
    const target = installments[0];

    const r = await recordInstallmentPayment({
      installmentId: target.id,
      paidAmount: 1000, // partial — installment.amount = 3000
      paymentMode: "cash",
      collectedById: worker.id,
    });
    expect(r.success).toBe(true);
    if (!r.success) return;
    created.paymentIds.push(r.paymentId);
    expect(r.isFullyPaid).toBe(false);

    const inst = await prisma.paymentInstallment.findUnique({
      where: { id: target.id },
    });
    // Service only flips to "paid" when fully paid; partial keeps prior status.
    expect(inst!.status).toBe("pending");
    expect(Number(inst!.paidAmount)).toBe(1000);
    expect(inst!.paidAt).toBeNull();

    // Ticket balanceDue updated by partial amount only.
    const t = await prisma.memberTicket.findUnique({ where: { id: ticket.id } });
    expect(Number(t!.amountPaid)).toBe(1000);
    expect(Number(t!.balanceDue)).toBe(5000);
  });

  it("schedule status flips to 'completed' when all installments paid", async () => {
    const ticket = await createTicket(9000);
    const day = 86400000;
    const { scheduleId, installments } = await createScheduleForCleanup(
      ticket.id,
      [
        { dueDate: new Date(Date.now() + 7 * day), amount: 3000 },
        { dueDate: new Date(Date.now() + 30 * day), amount: 3000 },
        { dueDate: new Date(Date.now() + 60 * day), amount: 3000 },
      ]
    );

    for (const inst of installments) {
      const r = await recordInstallmentPayment({
        installmentId: inst.id,
        paidAmount: Number(inst.amount),
        paymentMode: "cash",
        collectedById: worker.id,
      });
      expect(r.success).toBe(true);
      if (r.success) created.paymentIds.push(r.paymentId);
    }

    const sched = await prisma.paymentSchedule.findUnique({
      where: { id: scheduleId },
    });
    expect(sched!.status).toBe("completed");

    const allInst = await prisma.paymentInstallment.findMany({
      where: { scheduleId },
    });
    expect(allInst.every((i) => i.status === "paid")).toBe(true);

    const finalTicket = await prisma.memberTicket.findUnique({
      where: { id: ticket.id },
    });
    expect(Number(finalTicket!.balanceDue)).toBe(0);
    expect(Number(finalTicket!.amountPaid)).toBe(9000);
    // dueDate cleared once no pending installments remain.
    expect(finalTicket!.dueDate).toBeNull();
  });
});
