/**
 * Integration tests for renewMembership service.
 * Calls the service directly against a real database using SEED data.
 */
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { renewMembership } from "@/lib/services/renewal";
import { prisma, disconnectDb } from "@/tests/helpers/db";
import { SEED } from "@/tests/e2e/helpers";

// Track IDs created during tests for cleanup
const createdPaymentIds: number[] = [];
const createdTicketIds: number[] = [];
const createdInvoiceNumbers: string[] = [];
const createdUserIds: number[] = [];
let promoUsageCount = 0;

// Resolved at test-suite startup so tests don't depend on a hardcoded
// SEED plan id that may map to an inactive imported plan in real DBs.
let activePlan: { id: number; price: number; days: number };

// Common renewal params using SEED data — planId is patched in beforeAll().
const baseParams: {
  planId: number;
  locationId: number;
  paymentMode: string;
  collectedById: number;
} = {
  planId: 0,
  locationId: SEED.locations.main.id,
  paymentMode: "cash",
  collectedById: SEED.admin.id,
};

afterAll(async () => {
  // Clean up in dependency order: invoices -> payments -> audit logs -> tickets -> users
  if (createdInvoiceNumbers.length > 0) {
    await prisma.invoice.deleteMany({
      where: { invoiceNumber: { in: createdInvoiceNumbers } },
    });
  }
  if (createdPaymentIds.length > 0) {
    await prisma.payment.deleteMany({
      where: { id: { in: createdPaymentIds } },
    });
  }
  // Clean audit logs created by our test renewals (match by userId in details)
  for (const uid of createdUserIds) {
    await prisma.auditLog.deleteMany({
      where: {
        action: "renewal",
        details: { contains: `"userId":${uid}` },
      },
    });
  }
  if (createdTicketIds.length > 0) {
    await prisma.memberTicket.deleteMany({
      where: { id: { in: createdTicketIds } },
    });
  }
  // Reset in-app notifications before user deletion
  if (createdUserIds.length > 0) {
    await prisma.inAppNotification.deleteMany({
      where: { userId: { in: createdUserIds } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: createdUserIds } },
    });
  }
  // Reset WELCOME20 promo usedCount back (incremented by promo test)
  if (promoUsageCount > 0) {
    await prisma.promoCode.updateMany({
      where: { code: "WELCOME20" },
      data: { usedCount: { decrement: promoUsageCount } },
    });
  }
  await disconnectDb();
});

/**
 * Helper: create an isolated test user for renewals.
 * Uses @test.local suffix for cleanup compatibility.
 */
async function createTestMember(suffix: string) {
  const user = await prisma.user.create({
    data: {
      email: `renewal_${suffix}_${Date.now()}@test.local`,
      password: "$2b$10$fakehashfortesting000000000000000000000000000",
      firstname: "Test",
      lastname: suffix,
      phone: `90000${String(Date.now()).slice(-5)}`,
    },
  });
  createdUserIds.push(user.id);
  return user;
}

/**
 * Helper: track renewal result IDs for cleanup.
 */
function trackResult(result: any) {
  if (result.paymentId) createdPaymentIds.push(result.paymentId);
  if (result.invoiceNumber) createdInvoiceNumbers.push(result.invoiceNumber);
}

async function trackTicketsForUser(userId: number) {
  const tickets = await prisma.memberTicket.findMany({
    where: { userId },
    orderBy: { id: "desc" },
    take: 5,
  });
  for (const t of tickets) {
    if (!createdTicketIds.includes(t.id)) {
      createdTicketIds.push(t.id);
    }
  }
}

describe("renewMembership", () => {
  beforeAll(async () => {
    const plan = await prisma.ticketPlan.findFirst({ where: { isActive: true } });
    if (!plan) throw new Error("No active TicketPlan in DB — cannot run renewal tests");
    activePlan = {
      id: plan.id,
      price: Number(plan.price),
      days: plan.expireDays,
    };
    baseParams.planId = activePlan.id;

    // Imported FFF/EGYM DBs don't have demo promo codes — upsert the two
    // codes the suite expects so promo-path tests aren't dataset-coupled.
    const farFuture = new Date("2099-12-31");
    const farPast = new Date("2020-01-01");
    await prisma.promoCode.upsert({
      where: { code: "WELCOME20" },
      update: { isActive: true, discountType: "percentage", discountValue: 20 },
      create: {
        code: "WELCOME20",
        isActive: true,
        discountType: "percentage",
        discountValue: 20,
        validFrom: farPast,
        validTo: farFuture,
      },
    });
    await prisma.promoCode.upsert({
      where: { code: "SUMMER10" },
      update: { isActive: false },
      create: {
        code: "SUMMER10",
        isActive: false,
        discountType: "percentage",
        discountValue: 10,
        validFrom: farPast,
        validTo: farFuture,
      },
    });
  });

  it("happy path: creates ticket + payment + invoice", async () => {
    const user = await createTestMember("happy");

    const result = await renewMembership({
      ...baseParams,
      userId: user.id,
    });

    trackResult(result);
    await trackTicketsForUser(user.id);

    expect(result.success).toBe(true);
    expect(result.idempotent).toBe(false);
    expect(result.paymentId).toBeGreaterThan(0);
    expect(result.invoiceNumber).toMatch(/^INV-\d{4}-\d{4}$/);
    expect(result.newExpiryDate).toBeInstanceOf(Date);

    // Verify ticket was created
    const ticket = await prisma.memberTicket.findFirst({
      where: { userId: user.id },
      orderBy: { id: "desc" },
    });
    expect(ticket).not.toBeNull();
    expect(ticket!.planId).toBe(activePlan.id);
    expect(ticket!.locationId).toBe(SEED.locations.main.id);

    // Verify payment was created
    const payment = await prisma.payment.findUnique({
      where: { id: result.paymentId },
    });
    expect(payment).not.toBeNull();
    expect(Number(payment!.amount)).toBe(activePlan.price);
    expect(payment!.paymentMode).toBe("cash");

    // Verify invoice was created
    const invoice = await prisma.invoice.findFirst({
      where: { invoiceNumber: result.invoiceNumber },
    });
    expect(invoice).not.toBeNull();
    expect(invoice!.paymentId).toBe(result.paymentId);
  });

  it("idempotency: same params within 60s returns idempotent=true, no duplicate", async () => {
    const user = await createTestMember("idempotent");
    const params = { ...baseParams, userId: user.id };

    const first = await renewMembership(params);
    trackResult(first);
    await trackTicketsForUser(user.id);

    expect(first.idempotent).toBe(false);

    // Call again immediately — should be idempotent
    const second = await renewMembership(params);
    // Don't track second result; it should reuse first's records

    expect(second.success).toBe(true);
    expect(second.idempotent).toBe(true);
    expect(second.paymentId).toBe(first.paymentId);
    expect(second.invoiceNumber).toBe(first.invoiceNumber);

    // Verify only one ticket was created
    const tickets = await prisma.memberTicket.findMany({
      where: { userId: user.id },
    });
    expect(tickets).toHaveLength(1);
  });

  it("promo code WELCOME20: applies 20% discount", async () => {
    const user = await createTestMember("promo");
    const planPrice = activePlan.price;
    const expectedDiscount = Math.round(planPrice * 0.2);
    const expectedAmount = planPrice - expectedDiscount;

    const result = await renewMembership({
      ...baseParams,
      userId: user.id,
      promoCode: "WELCOME20",
    });

    trackResult(result);
    await trackTicketsForUser(user.id);

    promoUsageCount++;

    expect(result.success).toBe(true);
    expect(result.idempotent).toBe(false);

    // Verify discounted payment amount
    const payment = await prisma.payment.findUnique({
      where: { id: result.paymentId },
    });
    expect(Number(payment!.amount)).toBe(expectedAmount);

    // Verify audit log captured the discount
    const auditLog = await prisma.auditLog.findFirst({
      where: {
        action: "renewal",
        details: { contains: `"userId":${user.id}` },
      },
      orderBy: { id: "desc" },
    });
    expect(auditLog).not.toBeNull();
    const details = JSON.parse(auditLog!.details!);
    expect(details.discount).toBe(expectedDiscount);
    expect(details.amount).toBe(expectedAmount);
    expect(details.promoCode).toBe("WELCOME20");
  });

  it("invalid promo: inactive code SUMMER10 is rejected", async () => {
    const user = await createTestMember("badpromo");

    await expect(
      renewMembership({
        ...baseParams,
        userId: user.id,
        promoCode: "SUMMER10",
      })
    ).rejects.toThrow("Promo code is inactive");

    // No ticket should be created
    const tickets = await prisma.memberTicket.findMany({
      where: { userId: user.id },
    });
    expect(tickets).toHaveLength(0);
  });

  it("grace period: expired within 7 days is allowed", async () => {
    const user = await createTestMember("grace");

    // Create an expired ticket (expired 3 days ago — within 7-day grace)
    const expiredDate = new Date();
    expiredDate.setDate(expiredDate.getDate() - 3);
    const oldTicket = await prisma.memberTicket.create({
      data: {
        userId: user.id,
        planId: activePlan.id,
        locationId: SEED.locations.main.id,
        buyDate: new Date(Date.now() - 33 * 86400000),
        expireDate: expiredDate,
        occasions: null,
      },
    });
    createdTicketIds.push(oldTicket.id);

    // Renew — should succeed (expired member, starts from today)
    const result = await renewMembership({
      ...baseParams,
      userId: user.id,
    });

    trackResult(result);
    await trackTicketsForUser(user.id);

    expect(result.success).toBe(true);
    expect(result.idempotent).toBe(false);

    // New expiry should be ~30 days from today (not from old expiry)
    const newTicket = await prisma.memberTicket.findFirst({
      where: { userId: user.id },
      orderBy: { id: "desc" },
    });
    expect(newTicket).not.toBeNull();
    expect(newTicket!.id).not.toBe(oldTicket.id);

    // Expiry should be approximately today + plan days
    const expectedExpiry = new Date();
    expectedExpiry.setDate(expectedExpiry.getDate() + activePlan.days);
    const diffMs = Math.abs(
      newTicket!.expireDate.getTime() - expectedExpiry.getTime()
    );
    // Allow 2 day tolerance for timezone/IST midnight calculation
    expect(diffMs).toBeLessThan(2 * 86400000);
  });

  it("invalid inputs: non-existent userId throws error", async () => {
    await expect(
      renewMembership({
        ...baseParams,
        userId: 999999,
      })
    ).rejects.toThrow("User not found");
  });
});
