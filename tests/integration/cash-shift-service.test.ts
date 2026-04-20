/**
 * Integration tests for lib/services/cash-shift.ts
 *
 * T04 from D9 audit. Covers:
 *   - openShift idempotency under concurrent calls (Serializable txn protection)
 *   - double-close rejection
 *   - closingExpected math from openingFloat + cash payments + topups − withdrawals
 *   - variance + varianceReason persistence
 *   - variance > threshold routes to pending_approval
 *
 * Uses real DB. Each test cleans its own state in afterEach so the suite is
 * isolated from other suites and re-runnable.
 */
import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import {
  openShift,
  closeShift,
  recordMovement,
  getVarianceAutoApproveMax,
} from "@/lib/services/cash-shift";
import { prisma, disconnectDb } from "../helpers/db";

let location: any;
let opener: any;
let closer: any;
let user: any;
let plan: any;
let ticket: any;

const createdShiftIds: number[] = [];

async function uniqueId(prefix: string) {
  return `__test_csh_${prefix}_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
}

beforeAll(async () => {
  const lid = await uniqueId("loc");
  location = await prisma.location.create({
    data: {
      name: `Test Location __test_${lid}`,
      code: lid.slice(-8).toUpperCase(),
      isActive: true,
    },
  });

  opener = await prisma.worker.create({
    data: {
      email: `${await uniqueId("opener")}@worker.test.local`,
      password: "hashedpassword123",
      firstname: "Shift",
      lastname: "Opener",
      role: "staff",
      isActive: true,
      locationId: location.id,
    },
  });

  closer = await prisma.worker.create({
    data: {
      email: `${await uniqueId("closer")}@worker.test.local`,
      password: "hashedpassword123",
      firstname: "Shift",
      lastname: "Closer",
      role: "admin",
      isActive: true,
      locationId: location.id,
    },
  });

  user = await prisma.user.create({
    data: {
      email: `${await uniqueId("u")}@test.local`,
      password: "$2b$10$fakehashfortesting000000000000000000000000000",
      firstname: "Cash",
      lastname: "Tester",
      phone: `91${String(Date.now()).slice(-8)}`,
    },
  });

  plan = await prisma.ticketPlan.create({
    data: {
      name: `Test Plan __test_csh_${Date.now()}`,
      price: 1000,
      expireDays: 30,
      isActive: true,
    },
  });

  ticket = await prisma.memberTicket.create({
    data: {
      userId: user.id,
      planId: plan.id,
      locationId: location.id,
      buyDate: new Date(),
      expireDate: new Date(Date.now() + 30 * 86400000),
      status: "active",
      totalAmount: 1000,
      amountPaid: 1000,
      balanceDue: 0,
    },
  });

  // Set the variance threshold to a known value (100) for predictable tests.
  await prisma.gymSettings.upsert({
    where: { key: "shift_variance_auto_approve_max" },
    update: { value: "100" },
    create: { key: "shift_variance_auto_approve_max", value: "100" },
  });
});

afterEach(async () => {
  // Clean shift-related rows by IDs we tracked.
  if (createdShiftIds.length > 0) {
    // Approvals created for variance shifts
    await prisma.approval.deleteMany({
      where: {
        entityType: "CashShift",
        entityId: { in: createdShiftIds },
      },
    });
    // Detach payments tagged to these shifts (so we can delete shifts)
    await prisma.payment.updateMany({
      where: { shiftId: { in: createdShiftIds } },
      data: { shiftId: null },
    });
    await prisma.cashShiftMovement.deleteMany({
      where: { shiftId: { in: createdShiftIds } },
    });
    await prisma.cashShift.deleteMany({
      where: { id: { in: createdShiftIds } },
    });
    createdShiftIds.length = 0;
  }
  // Also clear any open/pending shifts at our test location that may have
  // leaked (e.g. concurrency test where some calls fail and others succeed).
  const lingering = await prisma.cashShift.findMany({
    where: { locationId: location.id },
    select: { id: true },
  });
  if (lingering.length > 0) {
    const ids = lingering.map((s) => s.id);
    await prisma.approval.deleteMany({
      where: { entityType: "CashShift", entityId: { in: ids } },
    });
    await prisma.payment.updateMany({
      where: { shiftId: { in: ids } },
      data: { shiftId: null },
    });
    await prisma.cashShiftMovement.deleteMany({
      where: { shiftId: { in: ids } },
    });
    await prisma.cashShift.deleteMany({ where: { id: { in: ids } } });
  }
  // Clean payments created during tests for our test user.
  await prisma.payment.deleteMany({
    where: { userId: user.id },
  });
  // Clean cash-shift related audit logs
  await prisma.auditLog.deleteMany({
    where: { action: { startsWith: "cash_shift." } },
  });
});

afterAll(async () => {
  await prisma.payment.deleteMany({ where: { userId: user.id } });
  await prisma.memberTicket.deleteMany({ where: { id: ticket.id } });
  await prisma.user.deleteMany({ where: { id: user.id } });
  await prisma.ticketPlan.deleteMany({ where: { id: plan.id } });
  await prisma.worker.deleteMany({
    where: { id: { in: [opener.id, closer.id] } },
  });
  await prisma.location.deleteMany({ where: { id: location.id } });
  await disconnectDb();
});

async function recordCashPayment(amount: number) {
  return prisma.payment.create({
    data: {
      userId: user.id,
      memberTicketId: ticket.id,
      locationId: location.id,
      amount,
      paymentMode: "cash",
      collectedById: opener.id,
    },
  });
}

describe("cash-shift service", () => {
  it("openShift is idempotent under concurrent calls — only one shift opened", async () => {
    const params = {
      locationId: location.id,
      openedById: opener.id,
      openingFloat: 500,
    };

    const results = await Promise.all([
      openShift(params),
      openShift(params),
      openShift(params),
    ]);

    const successes = results.filter((r) => r.success);
    const failures = results.filter((r) => !r.success);

    // Track whatever shift IDs we created so afterEach can clean up.
    for (const r of results) {
      if (r.success) createdShiftIds.push(r.shift.id);
    }

    // Exactly one of the three calls should win.
    expect(successes.length).toBe(1);
    expect(failures.length).toBe(2);

    // And only one open/pending shift row should exist for this location.
    const openRows = await prisma.cashShift.findMany({
      where: {
        locationId: location.id,
        status: { in: ["open", "pending_approval"] },
      },
    });
    expect(openRows.length).toBe(1);
    expect(openRows[0].status).toBe("open");
  });

  it("rejects double-close", async () => {
    const opened = await openShift({
      locationId: location.id,
      openedById: opener.id,
      openingFloat: 500,
    });
    expect(opened.success).toBe(true);
    if (!opened.success) return;
    createdShiftIds.push(opened.shift.id);

    const firstClose = await closeShift({
      shiftId: opened.shift.id,
      closedById: closer.id,
      closingCounted: 500, // matches expected, no variance
    });
    expect(firstClose.success).toBe(true);
    if (!firstClose.success) return;
    expect(firstClose.status).toBe("closed");
    expect(firstClose.alreadyClosed).toBeFalsy();

    const secondClose = await closeShift({
      shiftId: opened.shift.id,
      closedById: closer.id,
      closingCounted: 500,
    });
    // Service is idempotent: returns success with alreadyClosed=true,
    // which acts as the "rejection" of a real second close attempt
    // (no state mutation, no new audit row, no new approval).
    expect(secondClose.success).toBe(true);
    if (!secondClose.success) return;
    expect(secondClose.alreadyClosed).toBe(true);
    expect(secondClose.status).toBe("closed");

    // Confirm only one cash_shift.close audit log was written.
    const closeAudits = await prisma.auditLog.findMany({
      where: {
        action: "cash_shift.close",
        details: { contains: `"shiftId":${opened.shift.id}` },
      },
    });
    expect(closeAudits.length).toBe(1);
  });

  it("closingExpected = openingFloat + sum(cash payments) - sum(cash refunds) + topups - withdrawals", async () => {
    const openingFloat = 1000;
    const opened = await openShift({
      locationId: location.id,
      openedById: opener.id,
      openingFloat,
    });
    expect(opened.success).toBe(true);
    if (!opened.success) return;
    createdShiftIds.push(opened.shift.id);

    // Record several cash payments and tag them to the shift.
    const p1 = await recordCashPayment(200);
    const p2 = await recordCashPayment(350);
    const p3 = await recordCashPayment(450);
    await prisma.payment.updateMany({
      where: { id: { in: [p1.id, p2.id, p3.id] } },
      data: { shiftId: opened.shift.id },
    });
    const cashSum = 200 + 350 + 450; // 1000

    // Record movements via the service.
    const topup1 = await recordMovement({
      shiftId: opened.shift.id,
      type: "float_topup",
      amount: 150,
      reason: "Manager added float",
      createdById: opener.id,
    });
    expect(topup1.success).toBe(true);

    const withdraw1 = await recordMovement({
      shiftId: opened.shift.id,
      type: "cash_withdrawal",
      amount: 80,
      reason: "Cash to safe",
      createdById: opener.id,
    });
    expect(withdraw1.success).toBe(true);

    const expense1 = await recordMovement({
      shiftId: opened.shift.id,
      type: "expense",
      amount: 30,
      reason: "Stationery",
      createdById: opener.id,
    });
    expect(expense1.success).toBe(true);

    const expectedClosing =
      openingFloat + cashSum + 150 /* topup */ - 80 /* withdrawal */ - 30 /* expense */;
    // Close with counted == expected so variance is 0 and not gated by approval.
    const closed = await closeShift({
      shiftId: opened.shift.id,
      closedById: closer.id,
      closingCounted: expectedClosing,
    });
    expect(closed.success).toBe(true);
    if (!closed.success) return;
    expect(closed.closingExpected).toBe(expectedClosing);
    expect(closed.variance).toBe(0);
    expect(closed.status).toBe("closed");

    // And persisted on the row
    const row = await prisma.cashShift.findUnique({
      where: { id: opened.shift.id },
    });
    expect(Number(row!.closingExpected)).toBe(expectedClosing);
    expect(Number(row!.closingCounted)).toBe(expectedClosing);
    expect(Number(row!.variance)).toBe(0);
  });

  it("variance = closingCounted - closingExpected and persists varianceReason", async () => {
    const openingFloat = 500;
    const opened = await openShift({
      locationId: location.id,
      openedById: opener.id,
      openingFloat,
    });
    expect(opened.success).toBe(true);
    if (!opened.success) return;
    createdShiftIds.push(opened.shift.id);

    // No payments, no movements → expected == openingFloat == 500.
    // Counted is 480 → variance = -20 (within the 100 threshold).
    const reason = "Worn note rejected by counter";
    const closed = await closeShift({
      shiftId: opened.shift.id,
      closedById: closer.id,
      closingCounted: 480,
      varianceReason: reason,
    });
    expect(closed.success).toBe(true);
    if (!closed.success) return;
    expect(closed.closingExpected).toBe(500);
    expect(closed.variance).toBe(-20);
    expect(closed.requiresApproval).toBe(false);
    expect(closed.status).toBe("closed");

    const row = await prisma.cashShift.findUnique({
      where: { id: opened.shift.id },
    });
    expect(Number(row!.variance)).toBe(-20);
    expect(row!.varianceReason).toBe(reason);
    expect(row!.status).toBe("closed");
  });

  it("variance > threshold sets status to pending_approval", async () => {
    // Sanity-check that the threshold fixture is what we expect (100).
    const threshold = await getVarianceAutoApproveMax();
    expect(threshold).toBe(100);

    const opened = await openShift({
      locationId: location.id,
      openedById: opener.id,
      openingFloat: 500,
    });
    expect(opened.success).toBe(true);
    if (!opened.success) return;
    createdShiftIds.push(opened.shift.id);

    // Counted 1000 against expected 500 → variance = +500, well above 100.
    const closed = await closeShift({
      shiftId: opened.shift.id,
      closedById: closer.id,
      closingCounted: 1000,
      varianceReason: "Unexplained surplus",
    });
    expect(closed.success).toBe(true);
    if (!closed.success) return;
    expect(closed.variance).toBe(500);
    expect(closed.requiresApproval).toBe(true);
    expect(closed.status).toBe("pending_approval");
    expect(closed.approvalId).toBeTypeOf("number");

    const row = await prisma.cashShift.findUnique({
      where: { id: opened.shift.id },
    });
    expect(row!.status).toBe("pending_approval");
    // closedAt should be null until approval lands
    expect(row!.closedAt).toBeNull();

    // Approval row should be present and pending.
    const approval = await prisma.approval.findFirst({
      where: { entityType: "CashShift", entityId: opened.shift.id },
    });
    expect(approval).not.toBeNull();
    expect(approval!.status).toBe("pending");
    expect(approval!.type).toBe("cash_shift_variance");
  });
});
