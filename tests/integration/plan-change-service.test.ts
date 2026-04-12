/**
 * Integration tests for lib/services/plan-change.ts — upgradePlan()
 *
 * These tests call the service function directly (no auth context required).
 * Test data is created via the test prisma client and cleaned up in afterAll.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma, disconnectDb } from "../helpers/db";
import { upgradePlan } from "@/lib/services/plan-change";

// Track IDs for cleanup
const cleanup = {
  userIds: [] as number[],
  workerIds: [] as number[],
  planIds: [] as number[],
  locationIds: [] as number[],
  ticketIds: [] as number[],
  paymentIds: [] as number[],
  invoiceIds: [] as number[],
  auditLogIds: [] as number[],
};

let user: { id: number };
let worker: { id: number };
let oldPlan: { id: number; price: any; expireDays: number };
let newPlan: { id: number; price: any; expireDays: number };
let location: { id: number };

beforeAll(async () => {
  const uid = `__test_${Date.now()}`;

  user = await prisma.user.create({
    data: {
      firstname: "PlanChange",
      lastname: "User",
      email: `${uid}@test.local`,
      phone: "9000000001",
      password: "$2b$10$fakehashfortesting000000000000000000000000000",
    },
  });
  cleanup.userIds.push(user.id);

  worker = await prisma.worker.create({
    data: {
      firstname: "PlanChange",
      lastname: "Worker",
      email: `${uid}@worker.test.local`,
      password: "$2b$10$fakehashfortesting000000000000000000000000000",
      role: "admin",
    },
  });
  cleanup.workerIds.push(worker.id);

  oldPlan = await prisma.ticketPlan.create({
    data: {
      name: `Test Plan Old ${uid}`,
      price: 3000,
      expireDays: 30,
      isActive: true,
    },
  });
  cleanup.planIds.push(oldPlan.id);

  newPlan = await prisma.ticketPlan.create({
    data: {
      name: `Test Plan New ${uid}`,
      price: 9000,
      expireDays: 90,
      isActive: true,
    },
  });
  cleanup.planIds.push(newPlan.id);

  location = await prisma.location.create({
    data: {
      name: `Test Location ${uid}`,
      code: uid.slice(-8).toUpperCase(),
      isActive: true,
    },
  });
  cleanup.locationIds.push(location.id);
});

afterAll(async () => {
  // Delete in dependency order
  if (cleanup.auditLogIds.length)
    await prisma.auditLog.deleteMany({ where: { id: { in: cleanup.auditLogIds } } });
  if (cleanup.invoiceIds.length)
    await prisma.invoice.deleteMany({ where: { id: { in: cleanup.invoiceIds } } });
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
 * Helper: create a ticket with specific buy/expire dates for proration tests.
 */
async function createTicketWithDates(buyDate: Date, expireDate: Date) {
  const ticket = await prisma.memberTicket.create({
    data: {
      userId: user.id,
      planId: oldPlan.id,
      locationId: location.id,
      buyDate,
      expireDate,
      status: "active",
      totalAmount: Number(oldPlan.price),
      amountPaid: Number(oldPlan.price),
      balanceDue: 0,
    },
  });
  cleanup.ticketIds.push(ticket.id);
  return ticket;
}

/**
 * Helper: collect side-effect record IDs after a successful upgrade for cleanup.
 */
async function trackUpgradeArtifacts(result: any) {
  if (result.paymentId) cleanup.paymentIds.push(result.paymentId);

  // Find invoice by the returned invoiceNumber
  if (result.invoiceNumber) {
    const inv = await prisma.invoice.findFirst({
      where: { invoiceNumber: result.invoiceNumber },
    });
    if (inv) cleanup.invoiceIds.push(inv.id);
  }

  // Find the new ticket (latest for this user + new plan)
  const latestTicket = await prisma.memberTicket.findFirst({
    where: { userId: user.id, planId: newPlan.id },
    orderBy: { id: "desc" },
  });
  if (latestTicket && !cleanup.ticketIds.includes(latestTicket.id)) {
    cleanup.ticketIds.push(latestTicket.id);
  }

  // Find latest audit log for plan_change
  const log = await prisma.auditLog.findFirst({
    where: { action: "plan_change", actorId: worker.id },
    orderBy: { id: "desc" },
  });
  if (log) cleanup.auditLogIds.push(log.id);
}

describe("upgradePlan", () => {
  it("calculates proration credit correctly — half the period remaining", async () => {
    // 30-day plan bought 15 days ago → 15 remaining → credit = (15/30)*3000 = 1500
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const buyDate = new Date(now);
    buyDate.setDate(buyDate.getDate() - 15);
    const expireDate = new Date(now);
    expireDate.setDate(expireDate.getDate() + 15);

    const ticket = await createTicketWithDates(buyDate, expireDate);

    const result = await upgradePlan({
      userId: user.id,
      currentTicketId: ticket.id,
      newPlanId: newPlan.id,
      locationId: location.id,
      paymentMode: "cash",
      collectedById: worker.id,
    });

    await trackUpgradeArtifacts(result);

    expect(result.success).toBe(true);
    if (!result.success) return;

    // credit = (15 / 30) * 3000 = 1500
    expect(result.credit).toBe(1500);
    // amountDue = 9000 - 1500 = 7500
    expect(result.amountDue).toBe(7500);
  });

  it("calculates proration credit — 10 of 30 days remaining", async () => {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const buyDate = new Date(now);
    buyDate.setDate(buyDate.getDate() - 20);
    const expireDate = new Date(now);
    expireDate.setDate(expireDate.getDate() + 10);

    const ticket = await createTicketWithDates(buyDate, expireDate);

    const result = await upgradePlan({
      userId: user.id,
      currentTicketId: ticket.id,
      newPlanId: newPlan.id,
      locationId: location.id,
      paymentMode: "cash",
      collectedById: worker.id,
    });

    await trackUpgradeArtifacts(result);

    expect(result.success).toBe(true);
    if (!result.success) return;

    // credit = (10 / 30) * 3000 = 1000
    expect(result.credit).toBe(1000);
    // amountDue = 9000 - 1000 = 8000
    expect(result.amountDue).toBe(8000);
  });

  it("returns zero credit when ticket is already expired", async () => {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const buyDate = new Date(now);
    buyDate.setDate(buyDate.getDate() - 35);
    const expireDate = new Date(now);
    expireDate.setDate(expireDate.getDate() - 5);

    const ticket = await createTicketWithDates(buyDate, expireDate);

    const result = await upgradePlan({
      userId: user.id,
      currentTicketId: ticket.id,
      newPlanId: newPlan.id,
      locationId: location.id,
      paymentMode: "cash",
      collectedById: worker.id,
    });

    await trackUpgradeArtifacts(result);

    expect(result.success).toBe(true);
    if (!result.success) return;

    // No remaining days → credit = 0
    expect(result.credit).toBe(0);
    expect(result.amountDue).toBe(9000);
  });

  it("rejects downgrade when credit exceeds new plan price", async () => {
    // Create a cheap "new" plan that costs less than the credit
    const cheapPlan = await prisma.ticketPlan.create({
      data: {
        name: `Test Plan Cheap __test_${Date.now()}`,
        price: 500,
        expireDays: 15,
        isActive: true,
      },
    });
    cleanup.planIds.push(cheapPlan.id);

    // 30-day plan, all 30 days remaining → credit = 3000, but cheap plan = 500
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const buyDate = new Date(now);
    const expireDate = new Date(now);
    expireDate.setDate(expireDate.getDate() + 30);

    const ticket = await createTicketWithDates(buyDate, expireDate);

    const result = await upgradePlan({
      userId: user.id,
      currentTicketId: ticket.id,
      newPlanId: cheapPlan.id,
      locationId: location.id,
      paymentMode: "cash",
      collectedById: worker.id,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Downgrade not supported");
  });

  it("rejects upgrade to an inactive plan", async () => {
    const inactivePlan = await prisma.ticketPlan.create({
      data: {
        name: `Test Plan Inactive __test_${Date.now()}`,
        price: 5000,
        expireDays: 60,
        isActive: false,
      },
    });
    cleanup.planIds.push(inactivePlan.id);

    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const buyDate = new Date(now);
    const expireDate = new Date(now);
    expireDate.setDate(expireDate.getDate() + 30);

    const ticket = await createTicketWithDates(buyDate, expireDate);

    const result = await upgradePlan({
      userId: user.id,
      currentTicketId: ticket.id,
      newPlanId: inactivePlan.id,
      locationId: location.id,
      paymentMode: "cash",
      collectedById: worker.id,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("New plan is not active");
  });

  it("returns error for non-existent user", async () => {
    const result = await upgradePlan({
      userId: 999999,
      currentTicketId: 1,
      newPlanId: newPlan.id,
      locationId: location.id,
      paymentMode: "cash",
      collectedById: worker.id,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("User not found");
  });

  it("returns error for non-existent ticket", async () => {
    const result = await upgradePlan({
      userId: user.id,
      currentTicketId: 999999,
      newPlanId: newPlan.id,
      locationId: location.id,
      paymentMode: "cash",
      collectedById: worker.id,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("Current ticket not found");
  });

  /**
   * TIMEZONE CONCERN:
   * upgradePlan() uses `new Date()` (UTC-based) instead of `todayIST()` for
   * calculating "today". This means proration credit could be off by 1 day
   * around midnight IST (which is UTC+5:30). For example, at 11pm IST (5:30pm UTC),
   * `new Date()` still reports the same UTC date, but IST has already rolled over.
   * A member upgrading at 11:30pm IST could receive credit for one fewer day
   * than expected. This should be fixed to use `todayIST()` for Indian deployments.
   */
  it("documents timezone concern: service uses new Date() not todayIST()", () => {
    // This test exists solely to document the timezone concern above.
    // The proration calculation in plan-change.ts line 28-29 uses:
    //   const today = new Date();
    //   today.setHours(0, 0, 0, 0);
    // Instead of importing todayIST() from @/lib/utils/date.
    // In production (India), this could cause off-by-one proration errors
    // near midnight IST because new Date() gives UTC midnight, not IST midnight.
    expect(true).toBe(true);
  });
});
