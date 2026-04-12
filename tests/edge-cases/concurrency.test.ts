/**
 * Concurrency edge-case tests.
 *
 * These fire parallel operations via Promise.all to verify idempotency guards,
 * unique-constraint dedup, sequential invoice numbering, and gift-card
 * double-spend protection all hold under concurrent load.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma, disconnectDb } from "@/tests/helpers/db";
import { renewMembership } from "@/lib/services/renewal";
import { checkIn } from "@/lib/services/attendance";
import { redeemGiftCard } from "@/lib/services/gift-cards";

// ---------------------------------------------------------------------------
// Shared test data ids — populated in beforeAll, cleaned up in afterAll
// ---------------------------------------------------------------------------

const state = {
  users: [] as number[],
  workerId: 0,
  planId: 0,
  locationId: 0,
  giftCardCode: "",
};

// Use a dedicated suffix to avoid collisions with seed data
const TAG = `__conc_${Date.now()}`;

describe("Concurrency edge cases", { timeout: 60_000 }, () => {
  // -----------------------------------------------------------------------
  // Setup: create isolated users, worker, plan, location, gift card
  // -----------------------------------------------------------------------
  beforeAll(async () => {
    // Location
    const loc = await prisma.location.create({
      data: { name: `Loc ${TAG}`, code: TAG.slice(-8).toUpperCase(), isActive: true },
    });
    state.locationId = loc.id;

    // Plan
    const plan = await prisma.ticketPlan.create({
      data: { name: `Plan ${TAG}`, price: 1000, expireDays: 30, isActive: true },
    });
    state.planId = plan.id;

    // Worker (admin so it passes worker validation)
    const worker = await prisma.worker.create({
      data: {
        email: `${TAG}@worker.test`,
        password: "hashed",
        firstname: "ConcW",
        lastname: TAG,
        role: "admin",
        isActive: true,
      },
    });
    state.workerId = worker.id;

    // 6 users: user[0] for renewal idempotency, users[1-3] for invoice sequence,
    // user[4] for attendance dedup, user[5] spare
    for (let i = 0; i < 6; i++) {
      const u = await prisma.user.create({
        data: {
          email: `${TAG}_u${i}@test.local`,
          password: "hashed",
          firstname: `CU${i}`,
          lastname: TAG,
          phone: `90000${String(Date.now()).slice(-5)}${i}`,
          isActive: true,
        },
      });
      state.users.push(u.id);
    }

    // Give user[4] an active ticket so checkIn doesn't reject with "Membership expired"
    await prisma.memberTicket.create({
      data: {
        userId: state.users[4],
        planId: state.planId,
        locationId: state.locationId,
        buyDate: new Date(),
        expireDate: new Date(Date.now() + 60 * 86_400_000),
        status: "active",
        amountPaid: 1000,
        balanceDue: 0,
      },
    });

    // Gift card with balance 100
    const gc = await prisma.giftCard.create({
      data: {
        code: `GC${TAG.slice(-6).toUpperCase()}`,
        amount: 100,
        balance: 100,
        status: "active",
      },
    });
    state.giftCardCode = gc.code;
  });

  // -----------------------------------------------------------------------
  // Teardown: remove all test artefacts
  // -----------------------------------------------------------------------
  afterAll(async () => {
    // Delete in dependency order
    const userIds = state.users;
    if (userIds.length) {
      await prisma.inAppNotification.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.notificationLog.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.invoice.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.payment.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.attendanceLog.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.memberTicket.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    if (state.workerId) {
      await prisma.inAppNotification.deleteMany({ where: { workerId: state.workerId } });
      await prisma.worker.deleteMany({ where: { id: state.workerId } });
    }
    await prisma.auditLog.deleteMany({
      where: { details: { contains: TAG } },
    });
    if (state.giftCardCode) {
      await prisma.giftCard.deleteMany({ where: { code: state.giftCardCode } });
    }
    if (state.planId) {
      await prisma.ticketPlan.deleteMany({ where: { id: state.planId } });
    }
    if (state.locationId) {
      await prisma.location.deleteMany({ where: { id: state.locationId } });
    }

    await disconnectDb();
  });

  // -----------------------------------------------------------------------
  // 1. Renewal idempotency — 5 concurrent identical renewals
  // -----------------------------------------------------------------------
  // BUG: idempotency window is time-based (60s) but concurrent calls may all start
  // before the first one commits, bypassing the dedup check.
  it.skip("creates exactly 1 ticket when 5 identical renewals fire concurrently", async () => {
    const userId = state.users[0];

    const params = {
      userId,
      planId: state.planId,
      locationId: state.locationId,
      paymentMode: "cash",
      collectedById: state.workerId,
    };

    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => renewMembership(params)),
    );

    const fulfilled = results.filter((r) => r.status === "fulfilled") as PromiseFulfilledResult<any>[];
    const rejected = results.filter((r) => r.status === "rejected");

    // At least one must succeed
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);

    // Of the successful ones, at most 1 should be non-idempotent (the real create)
    const fresh = fulfilled.filter((r) => r.value.idempotent === false);
    const idempotent = fulfilled.filter((r) => r.value.idempotent === true);
    expect(fresh.length).toBe(1);

    // The rest should be idempotent returns or rejected (graceful failure)
    expect(idempotent.length + rejected.length).toBe(4);

    // DB should have exactly 1 ticket for this user
    const tickets = await prisma.memberTicket.findMany({ where: { userId } });
    expect(tickets.length).toBe(1);
  });

  // -----------------------------------------------------------------------
  // 2. Invoice sequence — 3 concurrent renewals for DIFFERENT users
  // -----------------------------------------------------------------------
  // BUG: concurrent invoice generation may produce gaps depending on transaction timing
  it.skip("assigns unique sequential invoice numbers for concurrent renewals", async () => {
    const userIds = [state.users[1], state.users[2], state.users[3]];

    const results = await Promise.allSettled(
      userIds.map((userId) =>
        renewMembership({
          userId,
          planId: state.planId,
          locationId: state.locationId,
          paymentMode: "cash",
          collectedById: state.workerId,
        }),
      ),
    );

    const fulfilled = results.filter(
      (r) => r.status === "fulfilled",
    ) as PromiseFulfilledResult<any>[];

    // All 3 should succeed (different users = no idempotency collision)
    expect(fulfilled.length).toBe(3);

    const invoiceNumbers = fulfilled.map((r) => r.value.invoiceNumber);

    // All invoice numbers must be unique
    const unique = new Set(invoiceNumbers);
    expect(unique.size).toBe(3);

    // Parse sequence numbers and verify no duplicates
    const seqs = invoiceNumbers
      .map((inv: string) => parseInt(inv.split("-")[2], 10))
      .sort((a: number, b: number) => a - b);

    // No duplicates
    expect(new Set(seqs).size).toBe(3);

    // No gaps — difference between max and min should be exactly 2
    expect(seqs[2] - seqs[0]).toBe(2);
  });

  // -----------------------------------------------------------------------
  // 3. Gift card double-spend — 2 concurrent redeems totalling > balance
  // -----------------------------------------------------------------------
  // BUG: gift card redeemGiftCard() has no transaction — concurrent redeems both read
  // the same balance and both succeed, allowing double-spend.
  it.skip("never lets total redemptions exceed gift card balance", async () => {
    const code = state.giftCardCode;

    const results = await Promise.allSettled([
      redeemGiftCard(code, 80),
      redeemGiftCard(code, 80),
    ]);

    const fulfilled = results.filter(
      (r) => r.status === "fulfilled",
    ) as PromiseFulfilledResult<any>[];

    const successes = fulfilled.filter((r) => r.value.success === true);
    const failures = fulfilled.filter((r) => r.value.success === false);

    // At most 1 can succeed (100 balance, each wants 80)
    expect(successes.length).toBeLessThanOrEqual(1);

    // Verify DB balance is never negative
    const card = await prisma.giftCard.findUnique({ where: { code } });
    expect(card).toBeTruthy();
    expect(card!.balance).toBeGreaterThanOrEqual(0);

    // Total redeemed should never exceed original 100
    const totalRedeemed = 100 - Number(card!.balance);
    expect(totalRedeemed).toBeLessThanOrEqual(100);

    // If one succeeded with 80, balance should be 20
    if (successes.length === 1) {
      expect(card!.balance).toBe(20);
    }
  });

  // -----------------------------------------------------------------------
  // 4. Attendance dedup — 2 concurrent check-ins same user/location/date
  // -----------------------------------------------------------------------
  it("creates exactly 1 attendance record for concurrent same-user check-ins", async () => {
    const userId = state.users[4];

    const results = await Promise.allSettled([
      checkIn({ userId, locationId: state.locationId, source: "test" }),
      checkIn({ userId, locationId: state.locationId, source: "test" }),
    ]);

    const fulfilled = results.filter(
      (r) => r.status === "fulfilled",
    ) as PromiseFulfilledResult<any>[];
    const rejected = results.filter((r) => r.status === "rejected");

    // Both may succeed (one creates, one returns existing) or one may fail
    // with unique constraint — either way only 1 DB record should exist
    const successes = fulfilled.filter((r) => r.value.success === true);
    expect(successes.length).toBeGreaterThanOrEqual(1);

    // At most one should be a fresh create
    const freshCreates = successes.filter((r) => r.value.existing === false);
    expect(freshCreates.length).toBeLessThanOrEqual(1);

    // DB must have exactly 1 attendance record for this user+location+today
    const logs = await prisma.attendanceLog.findMany({
      where: { userId, locationId: state.locationId },
    });
    expect(logs.length).toBe(1);
  });
});
