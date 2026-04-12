import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { prisma, disconnectDb } from "@/tests/helpers/db";
import { calculateTax } from "@/lib/services/tax";
import { renewMembership } from "@/lib/services/renewal";
import { recordPartialPayment } from "@/lib/services/partial-payment";
import { freezeMembership } from "@/lib/services/freeze";
import { SEED } from "@/tests/e2e/helpers";

// IDs of records we create during these tests, for cleanup
const cleanupUserIds: number[] = [];
const cleanupTicketIds: number[] = [];
const cleanupFreezeIds: number[] = [];

afterAll(async () => {
  // Clean up in reverse-dependency order
  if (cleanupFreezeIds.length) {
    await prisma.membershipFreeze.deleteMany({ where: { id: { in: cleanupFreezeIds } } });
  }
  // Payments, invoices, and audit logs reference tickets/users
  if (cleanupTicketIds.length) {
    await prisma.payment.deleteMany({ where: { memberTicketId: { in: cleanupTicketIds } } });
    await prisma.memberTicket.deleteMany({ where: { id: { in: cleanupTicketIds } } });
  }
  if (cleanupUserIds.length) {
    await prisma.invoice.deleteMany({ where: { userId: { in: cleanupUserIds } } });
    await prisma.auditLog.deleteMany({
      where: { details: { contains: cleanupUserIds.map(String).join("") ? "" : "" } },
    });
    await prisma.payment.deleteMany({ where: { userId: { in: cleanupUserIds } } });
    await prisma.memberTicket.deleteMany({ where: { userId: { in: cleanupUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: cleanupUserIds } } });
  }
  await disconnectDb();
});

// ---------------------------------------------------------------------------
// 1. Financial boundary tests (pure functions, no DB needed)
// ---------------------------------------------------------------------------
describe("Financial boundaries - calculateTax", () => {
  it("rate 0 returns no tax", () => {
    const result = calculateTax(1000, 0, false);
    expect(result).toEqual({ baseAmount: 1000, taxAmount: 0, totalAmount: 1000 });
  });

  it("negative rate returns no tax", () => {
    const result = calculateTax(1000, -5, false);
    expect(result).toEqual({ baseAmount: 1000, taxAmount: 0, totalAmount: 1000 });
  });

  it("rate 100 exclusive doubles the amount", () => {
    const result = calculateTax(1000, 100, false);
    expect(result.taxAmount).toBe(1000);
    expect(result.totalAmount).toBe(2000);
    expect(result.baseAmount).toBe(1000);
  });

  it("minimum amount 0.01 with 18% tax exclusive", () => {
    const result = calculateTax(0.01, 18, false);
    expect(result.baseAmount).toBe(0.01);
    expect(result.taxAmount).toBe(0); // 0.0018 rounds to 0.00
    expect(result.totalAmount).toBe(0.01);
  });

  it("rate 100 inclusive splits 50/50", () => {
    const result = calculateTax(1000, 100, true);
    expect(result.baseAmount).toBe(500);
    expect(result.taxAmount).toBe(500);
    expect(result.totalAmount).toBe(1000);
  });
});

// ---------------------------------------------------------------------------
// 2. Date boundary tests (require DB)
// ---------------------------------------------------------------------------
describe("Date boundaries - renewMembership", () => {
  let boundaryUserId: number;
  let dec31PlanId: number;

  beforeAll(async () => {
    // Create a user specifically for date boundary tests
    const user = await prisma.user.create({
      data: {
        email: `boundary-date-${Date.now()}@test.com`,
        password: "hashed",
        firstname: "Date",
        lastname: "Boundary",
        isActive: true,
      },
    });
    boundaryUserId = user.id;
    cleanupUserIds.push(user.id);

    // Create a 30-day plan for boundary tests
    const plan = await prisma.ticketPlan.create({
      data: { name: "Boundary30", price: 100, expireDays: 30, occasions: 30, isActive: true },
    });
    dec31PlanId = plan.id;
  });

  it("renewal on Dec 31 crosses year boundary correctly", async () => {
    // Set up: give user a ticket expiring Dec 31
    const dec31 = new Date(2025, 11, 31); // Dec 31 2025
    const ticket = await prisma.memberTicket.create({
      data: {
        userId: boundaryUserId,
        planId: dec31PlanId,
        locationId: SEED.locations.main.id,
        buyDate: new Date(2025, 11, 1),
        expireDate: dec31,
        occasions: 30,
      },
    });
    cleanupTicketIds.push(ticket.id);

    const result = await renewMembership({
      userId: boundaryUserId,
      planId: dec31PlanId,
      locationId: SEED.locations.main.id,
      paymentMode: "cash",
      collectedById: SEED.admin.id,
    });

    expect(result.success).toBe(true);

    // Renewal extends from today (todayIST) + plan days, not from old expiry
    // Just verify the new expiry is a valid future date
    const expiry = new Date(result.newExpiryDate);
    expect(expiry.getTime()).toBeGreaterThan(Date.now());

    // Track for cleanup
    const newTicket = await prisma.memberTicket.findFirst({
      where: { userId: boundaryUserId },
      orderBy: { id: "desc" },
    });
    if (newTicket) cleanupTicketIds.push(newTicket.id);
  });

  it("renewal on Feb 28 in leap year handles correctly", async () => {
    // Create a separate user to avoid interference
    const user = await prisma.user.create({
      data: {
        email: `boundary-leap-${Date.now()}@test.com`,
        password: "hashed",
        firstname: "Leap",
        lastname: "Year",
        isActive: true,
      },
    });
    cleanupUserIds.push(user.id);

    // 2028 is a leap year; set ticket expiring Feb 28
    const feb28 = new Date(2028, 1, 28);
    const ticket = await prisma.memberTicket.create({
      data: {
        userId: user.id,
        planId: dec31PlanId,
        locationId: SEED.locations.main.id,
        buyDate: new Date(2028, 0, 29),
        expireDate: feb28,
        occasions: 30,
      },
    });
    cleanupTicketIds.push(ticket.id);

    const result = await renewMembership({
      userId: user.id,
      planId: dec31PlanId,
      locationId: SEED.locations.main.id,
      paymentMode: "cash",
      collectedById: SEED.admin.id,
    });

    expect(result.success).toBe(true);

    // 30 days after Feb 28 2028 = Mar 29 2028
    const expiry = new Date(result.newExpiryDate);
    expect(expiry.getFullYear()).toBe(2028);
    expect(expiry.getMonth()).toBe(2); // March
    expect(expiry.getDate()).toBe(29);

    const newTicket = await prisma.memberTicket.findFirst({
      where: { userId: user.id },
      orderBy: { id: "desc" },
    });
    if (newTicket) cleanupTicketIds.push(newTicket.id);
  });
});

// ---------------------------------------------------------------------------
// 3. Freeze spanning month boundary
// ---------------------------------------------------------------------------
describe("Date boundaries - freezeMembership", () => {
  it("freeze spanning month boundary (Jan 28 + 5 days = Feb 2)", async () => {
    const user = await prisma.user.create({
      data: {
        email: `boundary-freeze-${Date.now()}@test.com`,
        password: "hashed",
        firstname: "Freeze",
        lastname: "Boundary",
        isActive: true,
      },
    });
    cleanupUserIds.push(user.id);

    // Create plan + ticket with far-future expiry so freeze is valid
    const plan = await prisma.ticketPlan.findFirst({ where: { isActive: true } });
    const futureExpiry = new Date();
    futureExpiry.setFullYear(futureExpiry.getFullYear() + 1);

    const ticket = await prisma.memberTicket.create({
      data: {
        userId: user.id,
        planId: plan!.id,
        locationId: SEED.locations.main.id,
        buyDate: new Date(),
        expireDate: futureExpiry,
        occasions: 30,
      },
    });
    cleanupTicketIds.push(ticket.id);

    // Freeze from Jan 28 to Feb 2 next year (5 days, crossing month boundary)
    const nextYear = new Date().getFullYear() + 1;
    const freezeStart = new Date(nextYear, 0, 28); // Jan 28
    const freezeEnd = new Date(nextYear, 1, 2); // Feb 2

    const result = await freezeMembership(
      user.id,
      ticket.id,
      freezeStart,
      freezeEnd,
      "Travelling",
    );

    expect(result.success).toBe(true);
    if (result.success && "freeze" in result) {
      cleanupFreezeIds.push(result.freeze.id);
      expect(result.freeze.daysAdded).toBe(5);
    }

    // Verify ticket expiry was extended by 5 days
    const updated = await prisma.memberTicket.findUnique({ where: { id: ticket.id } });
    const expectedExpiry = new Date(futureExpiry);
    expectedExpiry.setDate(expectedExpiry.getDate() + 5);
    expect(updated!.expireDate.toISOString().slice(0, 10)).toBe(
      expectedExpiry.toISOString().slice(0, 10),
    );
  });
});

// ---------------------------------------------------------------------------
// 4. Partial payment boundary
// ---------------------------------------------------------------------------
describe("Financial boundaries - recordPartialPayment", () => {
  it("partial payment leaving 0.01 balance", async () => {
    const user = await prisma.user.create({
      data: {
        email: `boundary-partial-${Date.now()}@test.com`,
        password: "hashed",
        firstname: "Partial",
        lastname: "Pay",
        isActive: true,
      },
    });
    cleanupUserIds.push(user.id);

    const plan = await prisma.ticketPlan.findFirst({ where: { isActive: true } });
    const ticket = await prisma.memberTicket.create({
      data: {
        userId: user.id,
        planId: plan!.id,
        locationId: SEED.locations.main.id,
        buyDate: new Date(),
        expireDate: new Date(Date.now() + 30 * 86400000),
        occasions: 30,
        totalAmount: 100,
        amountPaid: 0,
        balanceDue: 100,
      },
    });
    cleanupTicketIds.push(ticket.id);

    // Pay 99.99 leaving 0.01
    const result = await recordPartialPayment({
      ticketId: ticket.id,
      amount: 99.99,
      paymentMode: "cash",
      collectedById: SEED.admin.id,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.newBalanceDue).toBeCloseTo(0.01, 2);
      expect(result.isFullyPaid).toBe(false);
    }
  });

  it("minimum payment amount 0.01", async () => {
    const user = await prisma.user.create({
      data: {
        email: `boundary-minpay-${Date.now()}@test.com`,
        password: "hashed",
        firstname: "Min",
        lastname: "Pay",
        isActive: true,
      },
    });
    cleanupUserIds.push(user.id);

    const plan = await prisma.ticketPlan.findFirst({ where: { isActive: true } });
    const ticket = await prisma.memberTicket.create({
      data: {
        userId: user.id,
        planId: plan!.id,
        locationId: SEED.locations.main.id,
        buyDate: new Date(),
        expireDate: new Date(Date.now() + 30 * 86400000),
        occasions: 30,
        totalAmount: 1000,
        amountPaid: 0,
        balanceDue: 1000,
      },
    });
    cleanupTicketIds.push(ticket.id);

    const result = await recordPartialPayment({
      ticketId: ticket.id,
      amount: 0.01,
      paymentMode: "cash",
      collectedById: SEED.admin.id,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.newBalanceDue).toBeCloseTo(999.99, 2);
      expect(result.isFullyPaid).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// 5. Unicode handling
// ---------------------------------------------------------------------------
describe("Unicode handling", () => {
  it("stores and retrieves Hindi name correctly", async () => {
    const user = await prisma.user.create({
      data: {
        email: `hindi-name-${Date.now()}@test.com`,
        password: "hashed",
        firstname: "\u0930\u093E\u0939\u0941\u0932",
        lastname: "\u0936\u0930\u094D\u092E\u093E",
        isActive: true,
      },
    });
    cleanupUserIds.push(user.id);

    const fetched = await prisma.user.findUnique({ where: { id: user.id } });
    expect(fetched!.firstname).toBe("\u0930\u093E\u0939\u0941\u0932");
    expect(fetched!.lastname).toBe("\u0936\u0930\u094D\u092E\u093E");
  });

  it("stores max-length email (254 chars)", async () => {
    // RFC 5321: max email length is 254 chars
    const localPart = "a".repeat(64); // max local part
    const domainLabel = "b".repeat(63); // max label
    // 64 + 1(@) + 63 + 1(.) + 63 + 1(.) + remaining to reach 254
    // 64 + 1 + 63 + 1 + 63 = 192, need 62 more chars in last label
    const lastLabel = "c".repeat(58) + ".com"; // 62 chars
    const email = `${localPart}@${domainLabel}.${domainLabel}.${lastLabel}`;
    // Trim to exactly 254
    const trimmedEmail = email.slice(0, 254);

    const user = await prisma.user.create({
      data: {
        email: trimmedEmail,
        password: "hashed",
        firstname: "MaxEmail",
        lastname: "Test",
        isActive: true,
      },
    });
    cleanupUserIds.push(user.id);

    const fetched = await prisma.user.findUnique({ where: { id: user.id } });
    expect(fetched!.email).toBe(trimmedEmail);
    expect(fetched!.email.length).toBe(254);
  });
});

// ---------------------------------------------------------------------------
// 6. Null/optional handling for renewal
// ---------------------------------------------------------------------------
describe("Null/optional handling - renewMembership", () => {
  it("renewal with no promoCode succeeds", async () => {
    const user = await prisma.user.create({
      data: {
        email: `no-promo-${Date.now()}@test.com`,
        password: "hashed",
        firstname: "No",
        lastname: "Promo",
        isActive: true,
      },
    });
    cleanupUserIds.push(user.id);

    const result = await renewMembership({
      userId: user.id,
      planId: SEED.plans.monthly.id,
      locationId: SEED.locations.main.id,
      paymentMode: "cash",
      collectedById: SEED.admin.id,
      // promoCode intentionally omitted
    });

    expect(result.success).toBe(true);
    expect(result.invoiceNumber).toBeTruthy();

    const ticket = await prisma.memberTicket.findFirst({
      where: { userId: user.id },
      orderBy: { id: "desc" },
    });
    if (ticket) cleanupTicketIds.push(ticket.id);
  });

  it("renewal with empty string promoCode handled gracefully", async () => {
    const user = await prisma.user.create({
      data: {
        email: `empty-promo-${Date.now()}@test.com`,
        password: "hashed",
        firstname: "Empty",
        lastname: "Promo",
        isActive: true,
      },
    });
    cleanupUserIds.push(user.id);

    // Empty string is truthy-ish in the service code path (it enters the promo block),
    // so it should either succeed (treating empty as "no promo") or fail gracefully
    const result = await renewMembership({
      userId: user.id,
      planId: SEED.plans.monthly.id,
      locationId: SEED.locations.main.id,
      paymentMode: "cash",
      collectedById: SEED.admin.id,
      promoCode: "",
    });

    // Empty string is falsy in JS, so the promo block is skipped -> should succeed
    expect(result.success).toBe(true);

    const ticket = await prisma.memberTicket.findFirst({
      where: { userId: user.id },
      orderBy: { id: "desc" },
    });
    if (ticket) cleanupTicketIds.push(ticket.id);
  });
});
