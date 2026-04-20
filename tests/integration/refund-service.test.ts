/**
 * Integration tests for lib/services/refund.ts
 *
 * Covers:
 *   - requestRefund cumulative guard (pending + approved + processed)
 *   - approveRefund happy path
 *   - processRefund money movement (negative Payment row) + audit log
 *   - rejectRefund terminal behavior
 *   - partial refund leaves remaining headroom
 *
 * Tests call the service functions directly. Test data is created via the
 * test prisma client and cleaned up after each test (afterEach) so test
 * isolation is preserved.
 */
import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  afterEach,
} from "vitest";
import { prisma, disconnectDb } from "../helpers/db";
import {
  requestRefund,
  approveRefund,
  processRefund,
  rejectRefund,
} from "@/lib/services/refund";

// ─────────────────────────────────────────────────────────────────────────────
// Shared fixtures (worker / user / plan / location) — created once per file.
// Per-test rows (ticket, payment, refund, approval, audit log, reversing
// payment) are tracked in `perTest` and cleaned up in afterEach.
// ─────────────────────────────────────────────────────────────────────────────

let user: { id: number };
let worker: { id: number };
let plan: { id: number };
let location: { id: number };

const perTest = {
  ticketIds: [] as number[],
  paymentIds: [] as number[],
  invoiceIds: [] as number[],
  refundIds: [] as number[],
  approvalIds: [] as number[],
  auditLogIds: [] as number[],
};

beforeAll(async () => {
  const uid = `__test_refund_${Date.now()}`;

  user = await prisma.user.create({
    data: {
      firstname: "Refund",
      lastname: "TestUser",
      email: `${uid}@test.local`,
      phone: "9000000099",
      password: "$2b$10$fakehashfortesting000000000000000000000000000",
    },
  });

  worker = await prisma.worker.create({
    data: {
      firstname: "Refund",
      lastname: "TestWorker",
      email: `${uid}@worker.test.local`,
      password: "$2b$10$fakehashfortesting000000000000000000000000000",
      role: "admin",
    },
  });

  plan = await prisma.ticketPlan.create({
    data: {
      name: `Test Plan Refund ${uid}`,
      price: 1000,
      expireDays: 30,
      isActive: true,
    },
  });

  location = await prisma.location.create({
    data: {
      name: `Test Location Refund ${uid}`,
      code: uid.slice(-8).toUpperCase(),
      isActive: true,
    },
  });
});

afterEach(async () => {
  // Audit logs from refund actions for this worker
  if (perTest.refundIds.length) {
    const logs = await prisma.auditLog.findMany({
      where: {
        action: { in: ["refund.request", "refund.approve", "refund.process", "refund.reject"] },
        actorId: worker.id,
      },
      select: { id: true },
    });
    const logIds = logs.map((l) => l.id);
    if (logIds.length)
      await prisma.auditLog.deleteMany({ where: { id: { in: logIds } } });
  }

  // Approvals raised by requestRefund
  if (perTest.refundIds.length) {
    const approvals = await prisma.approval.findMany({
      where: { type: "refund", entityId: { in: perTest.refundIds } },
      select: { id: true },
    });
    if (approvals.length)
      await prisma.approval.deleteMany({
        where: { id: { in: approvals.map((a) => a.id) } },
      });
  }

  if (perTest.refundIds.length)
    await prisma.refund.deleteMany({ where: { id: { in: perTest.refundIds } } });

  // Reversing payments + originals — collect any payments referencing the
  // tracked tickets to be safe (processRefund inserts negative payment rows
  // we don't get IDs back for in failure paths).
  if (perTest.ticketIds.length) {
    await prisma.payment.deleteMany({
      where: { memberTicketId: { in: perTest.ticketIds } },
    });
  } else if (perTest.paymentIds.length) {
    await prisma.payment.deleteMany({
      where: { id: { in: perTest.paymentIds } },
    });
  }

  if (perTest.invoiceIds.length)
    await prisma.invoice.deleteMany({ where: { id: { in: perTest.invoiceIds } } });
  if (perTest.ticketIds.length)
    await prisma.memberTicket.deleteMany({ where: { id: { in: perTest.ticketIds } } });

  perTest.ticketIds = [];
  perTest.paymentIds = [];
  perTest.invoiceIds = [];
  perTest.refundIds = [];
  perTest.approvalIds = [];
  perTest.auditLogIds = [];
});

afterAll(async () => {
  await prisma.ticketPlan
    .delete({ where: { id: plan.id } })
    .catch(() => undefined);
  await prisma.location
    .delete({ where: { id: location.id } })
    .catch(() => undefined);
  await prisma.worker
    .delete({ where: { id: worker.id } })
    .catch(() => undefined);
  await prisma.user
    .delete({ where: { id: user.id } })
    .catch(() => undefined);
  await disconnectDb();
});

/**
 * Create a ticket + a fully-paid Payment of `paymentAmount` for it.
 * Returns the payment id which is the input to requestRefund().
 */
async function createPaidTicket(paymentAmount: number) {
  const ticket = await prisma.memberTicket.create({
    data: {
      userId: user.id,
      planId: plan.id,
      locationId: location.id,
      buyDate: new Date(),
      expireDate: new Date(Date.now() + 30 * 86400000),
      status: "active",
      totalAmount: paymentAmount,
      amountPaid: paymentAmount,
      balanceDue: 0,
    },
  });
  perTest.ticketIds.push(ticket.id);

  const payment = await prisma.payment.create({
    data: {
      userId: user.id,
      memberTicketId: ticket.id,
      locationId: location.id,
      amount: paymentAmount,
      paymentMode: "cash",
      collectedById: worker.id,
      paymentStatus: "full",
      paymentFor: "renewal",
    },
  });
  perTest.paymentIds.push(payment.id);

  return { ticket, payment };
}

/**
 * Convenience: requestRefund and capture refundId for cleanup.
 */
async function request(paymentId: number, amount: number) {
  const res = await requestRefund({
    paymentId,
    amountRequested: amount,
    reason: "dissatisfied",
    refundMode: "cash",
    requestedById: worker.id,
  });
  if (res.success) {
    perTest.refundIds.push(res.refundId);
    perTest.approvalIds.push(res.approvalId);
  }
  return res;
}

describe("refund service", () => {
  it("rejects double-refund — cumulative across pending+approved+processed cannot exceed paymentAmount", async () => {
    const { payment } = await createPaidTicket(1000);

    const first = await request(payment.id, 600);
    expect(first.success).toBe(true);

    // Second request would push cumulative pending to 1100 > 1000 → must fail
    const second = await request(payment.id, 500);
    expect(second.success).toBe(false);
    if (!second.success) {
      expect(second.error).toMatch(/exceeds payment amount/i);
    }
  });

  it("processRefund creates negative Payment row", async () => {
    const { payment } = await createPaidTicket(1000);

    const req = await request(payment.id, 400);
    expect(req.success).toBe(true);
    if (!req.success) return;

    const appr = await approveRefund(req.refundId, worker.id);
    expect(appr.success).toBe(true);

    const proc = await processRefund({
      refundId: req.refundId,
      processedById: worker.id,
    });
    expect(proc.success).toBe(true);
    if (!proc.success) return;

    expect(proc.reversingPaymentId).toBeDefined();

    const reversing = await prisma.payment.findUnique({
      where: { id: proc.reversingPaymentId! },
    });
    expect(reversing).not.toBeNull();
    expect(Number(reversing!.amount)).toBe(-400);
    expect(reversing!.paymentMode).toBe("refund");
    expect(reversing!.paymentFor).toBe("refund");
    // Linked to the same ticket as the original payment
    expect(reversing!.memberTicketId).toBe(payment.memberTicketId);
    expect(reversing!.userId).toBe(payment.userId);
  });

  it("processRefund writes AuditLog entry", async () => {
    const { payment } = await createPaidTicket(1000);

    const req = await request(payment.id, 250);
    expect(req.success).toBe(true);
    if (!req.success) return;

    await approveRefund(req.refundId, worker.id);
    const proc = await processRefund({
      refundId: req.refundId,
      processedById: worker.id,
    });
    expect(proc.success).toBe(true);

    const log = await prisma.auditLog.findFirst({
      where: { action: "refund.process", actorId: worker.id },
      orderBy: { id: "desc" },
    });
    expect(log).not.toBeNull();
    expect(log!.actorType).toBe("worker");
    expect(log!.status).toBe("success");
    const details = JSON.parse(log!.details ?? "{}");
    expect(details.refundId).toBe(req.refundId);
    expect(details.paymentId).toBe(payment.id);
    expect(details.amountRefunded).toBe(250);
  });

  it("rejectRefund is terminal — cannot approve after reject", async () => {
    const { payment } = await createPaidTicket(1000);

    const req = await request(payment.id, 300);
    expect(req.success).toBe(true);
    if (!req.success) return;

    const rej = await rejectRefund({
      refundId: req.refundId,
      decidedById: worker.id,
      decisionNote: "not eligible",
    });
    expect(rej.success).toBe(true);

    // Confirm the row is in rejected status
    const row = await prisma.refund.findUnique({ where: { id: req.refundId } });
    expect(row!.status).toBe("rejected");

    // approveRefund should NOT silently flip a rejected refund. The service
    // returns alreadyDecided=true (idempotent no-op) but never moves status
    // back to "approved".
    const appr = await approveRefund(req.refundId, worker.id);
    expect(appr.success).toBe(true);
    if (appr.success) {
      expect(appr.alreadyDecided).toBe(true);
    }

    const after = await prisma.refund.findUnique({ where: { id: req.refundId } });
    expect(after!.status).toBe("rejected");
    expect(after!.approvedAt).toBeNull();
    expect(after!.approvedById).toBeNull();
  });

  it("approveRefund moves status from pending to approved", async () => {
    const { payment } = await createPaidTicket(1000);

    const req = await request(payment.id, 500);
    expect(req.success).toBe(true);
    if (!req.success) return;

    const before = await prisma.refund.findUnique({ where: { id: req.refundId } });
    expect(before!.status).toBe("pending");

    const appr = await approveRefund(req.refundId, worker.id, "ok");
    expect(appr.success).toBe(true);

    const after = await prisma.refund.findUnique({ where: { id: req.refundId } });
    expect(after!.status).toBe("approved");
    expect(after!.approvedById).toBe(worker.id);
    expect(after!.approvedAt).not.toBeNull();
  });

  it("partial refund leaves payment partially refundable", async () => {
    const { payment } = await createPaidTicket(1000);

    // First refund: 300, fully processed (money has left the till).
    const r1 = await request(payment.id, 300);
    expect(r1.success).toBe(true);
    if (!r1.success) return;
    await approveRefund(r1.refundId, worker.id);
    const proc1 = await processRefund({
      refundId: r1.refundId,
      processedById: worker.id,
    });
    expect(proc1.success).toBe(true);

    // Remaining headroom = 1000 - 300 = 700. A request for exactly 700 must
    // succeed (cumulative = processed 300 + pending 700 = 1000 ≤ 1000).
    const r2 = await request(payment.id, 700);
    expect(r2.success).toBe(true);

    // But one extra rupee on top must fail.
    const r3 = await request(payment.id, 1);
    expect(r3.success).toBe(false);
    if (!r3.success) {
      expect(r3.error).toMatch(/exceeds payment amount/i);
    }
  });
});
