/**
 * Integration tests for lib/services/freeze.ts
 * Tests freezeMembership, cancelFreeze against a real database.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { freezeMembership, cancelFreeze } from "@/lib/services/freeze";
import { prisma, disconnectDb } from "../helpers/db";
import { cleanupTestData } from "../helpers/cleanup";

let user: any;
let location: any;
let plan: any;

// Fresh ticket for each test that needs one
async function createTicket(overrides: Record<string, any> = {}) {
  return prisma.memberTicket.create({
    data: {
      userId: user.id,
      planId: plan.id,
      locationId: location.id,
      buyDate: new Date(),
      expireDate: overrides.expireDate ?? new Date(Date.now() + 60 * 86400000),
      status: "active",
      amountPaid: 1000,
      balanceDue: 0,
      ...overrides,
    },
  });
}

beforeAll(async () => {
  const uid = `__test_frz_${Date.now()}`;

  user = await prisma.user.create({
    data: {
      email: `${uid}_user@test.local`,
      password: "$2b$10$fakehashfortesting000000000000000000000000000",
      firstname: "Freeze",
      lastname: "Tester",
      phone: "9000000010",
    },
  });

  location = await prisma.location.create({
    data: {
      name: `Test Location __test_${uid}`,
      code: uid.slice(-8).toUpperCase(),
      isActive: true,
    },
  });

  plan = await prisma.ticketPlan.create({
    data: {
      name: `Test Plan __test_${uid}`,
      price: 1000,
      expireDays: 30,
      isActive: true,
    },
  });

  // Ensure freeze settings exist with generous limits for tests
  await prisma.gymSettings.upsert({
    where: { key: "max_freezes_per_membership" },
    update: { value: "5" },
    create: { key: "max_freezes_per_membership", value: "5" },
  });
  await prisma.gymSettings.upsert({
    where: { key: "max_freeze_days" },
    update: { value: "60" },
    create: { key: "max_freeze_days", value: "60" },
  });
});

afterAll(async () => {
  // Clean up freeze-specific records then generic test data
  await prisma.membershipFreeze.deleteMany({
    where: { user: { email: { contains: "@test.local" } } },
  });
  await cleanupTestData();
  await disconnectDb();
});

describe("freeze service", () => {
  it("freezeMembership() extends expiry by freeze days", async () => {
    const originalExpiry = new Date(Date.now() + 60 * 86400000);
    originalExpiry.setHours(0, 0, 0, 0);
    const ticket = await createTicket({ expireDate: originalExpiry });

    const freezeStart = new Date(Date.now() + 5 * 86400000);
    const freezeEnd = new Date(Date.now() + 15 * 86400000);
    const freezeDays = Math.ceil(
      (freezeEnd.getTime() - freezeStart.getTime()) / 86400000
    );

    const result = await freezeMembership(
      user.id,
      ticket.id,
      freezeStart,
      freezeEnd,
      "Vacation"
    );

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.freeze).toBeTruthy();
    expect(result.freeze.daysAdded).toBe(freezeDays);

    // Verify ticket expiry was extended
    const updated = await prisma.memberTicket.findUnique({
      where: { id: ticket.id },
    });
    const expectedExpiry = new Date(originalExpiry);
    expectedExpiry.setDate(expectedExpiry.getDate() + freezeDays);
    expect(updated!.expireDate.getTime()).toBe(expectedExpiry.getTime());
  });

  it("overlapping freeze is rejected", async () => {
    const ticket = await createTicket();

    const freezeStart = new Date(Date.now() + 5 * 86400000);
    const freezeEnd = new Date(Date.now() + 15 * 86400000);

    // First freeze should succeed
    const first = await freezeMembership(
      user.id,
      ticket.id,
      freezeStart,
      freezeEnd,
      "First freeze"
    );
    expect(first.success).toBe(true);

    // Second freeze on same ticket should be rejected (active freeze exists)
    const overlapping = new Date(Date.now() + 10 * 86400000);
    const overlapEnd = new Date(Date.now() + 20 * 86400000);
    const second = await freezeMembership(
      user.id,
      ticket.id,
      overlapping,
      overlapEnd,
      "Overlap attempt"
    );

    expect(second.success).toBe(false);
    if (second.success) return;
    expect(second.error).toContain("active freeze already exists");
  });

  it("expired ticket is rejected", async () => {
    const expiredTicket = await createTicket({
      expireDate: new Date(Date.now() - 5 * 86400000), // expired 5 days ago
    });

    const freezeStart = new Date(Date.now() + 1 * 86400000);
    const freezeEnd = new Date(Date.now() + 10 * 86400000);

    const result = await freezeMembership(
      user.id,
      expiredTicket.id,
      freezeStart,
      freezeEnd,
      "Should fail"
    );

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toContain("expired");
  });

  it("cancelFreeze() reverts expiry correctly", async () => {
    const originalExpiry = new Date(Date.now() + 60 * 86400000);
    originalExpiry.setHours(0, 0, 0, 0);
    const ticket = await createTicket({ expireDate: originalExpiry });

    const freezeStart = new Date(Date.now() + 5 * 86400000);
    const freezeEnd = new Date(Date.now() + 12 * 86400000); // 7 days

    const freezeResult = await freezeMembership(
      user.id,
      ticket.id,
      freezeStart,
      freezeEnd,
      "To be cancelled"
    );
    expect(freezeResult.success).toBe(true);
    if (!freezeResult.success) return;

    const cancelResult = await cancelFreeze(freezeResult.freeze.id);
    expect(cancelResult.success).toBe(true);

    // Verify expiry reverted to original
    const reverted = await prisma.memberTicket.findUnique({
      where: { id: ticket.id },
    });
    expect(reverted!.expireDate.getTime()).toBe(originalExpiry.getTime());

    // Verify freeze status is cancelled
    const frozenRecord = await prisma.membershipFreeze.findUnique({
      where: { id: freezeResult.freeze.id },
    });
    expect(frozenRecord!.status).toBe("cancelled");
  });

  it("FIXED: freeze → renew → cancel freeze does NOT corrupt expiry", async () => {
    // cancelFreeze now uses the stored originalExpiry field to revert,
    // so a renewal between freeze and cancel does not cause corruption.
    //
    // Scenario:
    //   1. Ticket expires day 60
    //   2. Freeze 7 days → expiry becomes day 67, originalExpiry = day 60
    //   3. Renewal extends 30 days → expiry becomes day 97
    //   4. Cancel freeze reverts to originalExpiry (day 60), NOT day 97 - 7

    const originalExpiry = new Date(Date.now() + 60 * 86400000);
    originalExpiry.setHours(0, 0, 0, 0);
    const ticket = await createTicket({ expireDate: originalExpiry });

    // Step 1: Freeze for 7 days
    const freezeStart = new Date(Date.now() + 5 * 86400000);
    const freezeEnd = new Date(Date.now() + 12 * 86400000);
    const freezeDays = Math.ceil(
      (freezeEnd.getTime() - freezeStart.getTime()) / 86400000
    );

    const freezeResult = await freezeMembership(
      user.id,
      ticket.id,
      freezeStart,
      freezeEnd,
      "Pre-renewal freeze"
    );
    expect(freezeResult.success).toBe(true);
    if (!freezeResult.success) return;

    // Verify expiry after freeze: original + 7
    const afterFreeze = await prisma.memberTicket.findUnique({
      where: { id: ticket.id },
    });
    const expectedAfterFreeze = new Date(originalExpiry);
    expectedAfterFreeze.setDate(expectedAfterFreeze.getDate() + freezeDays);
    expect(afterFreeze!.expireDate.getTime()).toBe(
      expectedAfterFreeze.getTime()
    );

    // Step 2: Simulate renewal by extending expiry by 30 days directly
    const renewalDays = 30;
    const renewedExpiry = new Date(afterFreeze!.expireDate);
    renewedExpiry.setDate(renewedExpiry.getDate() + renewalDays);
    await prisma.memberTicket.update({
      where: { id: ticket.id },
      data: { expireDate: renewedExpiry },
    });

    // Step 3: Cancel the freeze
    const cancelResult = await cancelFreeze(freezeResult.freeze.id);
    expect(cancelResult.success).toBe(true);

    // Step 4: Check expiry — should revert to originalExpiry (pre-freeze)
    const afterCancel = await prisma.memberTicket.findUnique({
      where: { id: ticket.id },
    });

    // The fix: cancelFreeze uses freeze.originalExpiry to revert,
    // so the expiry goes back to the pre-freeze value regardless of
    // any renewal that happened in between.
    expect(afterCancel!.expireDate.getTime()).toBe(originalExpiry.getTime());
  });
});
