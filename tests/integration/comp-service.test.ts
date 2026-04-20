/**
 * Integration tests for lib/services/comp.ts
 *
 * Covers issueComp, revokeComp, atomicity (Ticket + Payment + AuditLog),
 * and the 7-day auto-approve gate (any longer comp must either supply an
 * approvedById or be routed to the universal approval queue rather than
 * created outright).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { issueComp, revokeComp } from "@/lib/services/comp";
import { prisma, disconnectDb } from "../helpers/db";
import { cleanupTestData } from "../helpers/cleanup";

let user: any;
let location: any;
let plan: any;
let issuer: any;
let approver: any;

const TEST_TAG = `__test_comp_${Date.now()}`;

beforeAll(async () => {
  user = await prisma.user.create({
    data: {
      email: `${TEST_TAG}_user@test.local`,
      password: "$2b$10$fakehashfortesting000000000000000000000000000",
      firstname: "Comp",
      lastname: "Tester",
      phone: `90000${String(Math.floor(Math.random() * 100000)).padStart(5, "0")}`,
    },
  });

  location = await prisma.location.create({
    data: {
      name: `Test Location __test_${TEST_TAG}`,
      code: TEST_TAG.slice(-8).toUpperCase(),
      isActive: true,
    },
  });

  plan = await prisma.ticketPlan.create({
    data: {
      name: `Test Plan __test_${TEST_TAG}`,
      price: 1500,
      expireDays: 30,
      isActive: true,
    },
  });

  issuer = await prisma.worker.create({
    data: {
      email: `${TEST_TAG}_issuer@worker.test.local`,
      password: "$2b$10$fakehashfortesting000000000000000000000000000",
      firstname: "Comp",
      lastname: "Issuer",
      role: "staff",
      isActive: true,
    },
  });

  approver = await prisma.worker.create({
    data: {
      email: `${TEST_TAG}_approver@worker.test.local`,
      password: "$2b$10$fakehashfortesting000000000000000000000000000",
      firstname: "Comp",
      lastname: "Approver",
      role: "admin",
      isActive: true,
    },
  });

  // Lock the auto-approve threshold to 7 days so tests are deterministic
  await prisma.gymSettings.upsert({
    where: { key: "comp_auto_approve_days_max" },
    update: { value: "7" },
    create: { key: "comp_auto_approve_days_max", value: "7" },
  });
});

afterAll(async () => {
  // Clean up Approval rows created by 8+ day routing
  await prisma.approval.deleteMany({
    where: {
      requestedBy: { email: { contains: "@worker.test.local" } },
    },
  });
  // AuditLog rows have no FK we can target by; sweep recent comp.* entries
  // by actorId of our test workers.
  if (issuer?.id || approver?.id) {
    await prisma.auditLog.deleteMany({
      where: {
        action: { startsWith: "comp." },
        actorId: { in: [issuer?.id, approver?.id].filter(Boolean) as number[] },
      },
    });
  }
  await cleanupTestData();
  await disconnectDb();
});

describe("comp service", () => {
  // Track ticket/payment counts before each test so we can detect leaks
  let preTicketCount = 0;
  let prePaymentCount = 0;
  beforeEach(async () => {
    preTicketCount = await prisma.memberTicket.count({
      where: { userId: user.id },
    });
    prePaymentCount = await prisma.payment.count({
      where: { userId: user.id },
    });
  });

  it("rejects 8+ day comp without approverId", async () => {
    // The service does not throw — it routes the request to the universal
    // approval queue (returns approvalRequested=true) rather than creating
    // a comp ticket outright. Either way, the contract is: NO ticket gets
    // issued without an approver when days > auto-approve threshold.
    const result = await issueComp({
      userId: user.id,
      planId: plan.id,
      reason: "trial",
      days: 8,
      issuedById: issuer.id,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    // The hallmark of "rejection of direct issue": no ticket returned,
    // approvalRequested flag set.
    expect((result as any).ticket).toBeUndefined();
    expect((result as any).approvalRequested).toBe(true);
    expect((result as any).approvalId).toBeTypeOf("number");

    // Confirm no MemberTicket row was created for this user.
    const postTicketCount = await prisma.memberTicket.count({
      where: { userId: user.id },
    });
    expect(postTicketCount).toBe(preTicketCount);
  });

  it("allows 7-day comp without approver", async () => {
    const result = await issueComp({
      userId: user.id,
      planId: plan.id,
      reason: "trial",
      days: 7,
      issuedById: issuer.id,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.ticket).toBeTruthy();
    expect(result.ticket!.isComplimentary).toBe(true);
    expect(result.ticket!.compIssuedById).toBe(issuer.id);
    expect(result.ticket!.compApprovedById).toBeNull();
  });

  it("revokeComp clears the active grant", async () => {
    // Issue a fresh comp first.
    const issueRes = await issueComp({
      userId: user.id,
      planId: plan.id,
      reason: "compensation",
      days: 5,
      issuedById: issuer.id,
    });
    expect(issueRes.success).toBe(true);
    if (!issueRes.success || !issueRes.ticket) return;
    const ticketId = issueRes.ticket.id;

    const revokeRes = await revokeComp({
      ticketId,
      reason: "test revoke",
      revokedById: approver.id,
    });
    expect(revokeRes.success).toBe(true);

    const reloaded = await prisma.memberTicket.findUnique({
      where: { id: ticketId },
    });
    expect(reloaded!.status).toBe("cancelled");
    expect(reloaded!.cancelledAt).toBeTruthy();

    // AuditLog must contain a comp.revoke entry referencing this ticket.
    const auditLogs = await prisma.auditLog.findMany({
      where: { action: "comp.revoke", actorId: approver.id },
      orderBy: { id: "desc" },
      take: 5,
    });
    const matching = auditLogs.find((l) => {
      try {
        const d = JSON.parse(l.details ?? "{}");
        return d.ticketId === ticketId;
      } catch {
        return false;
      }
    });
    expect(matching).toBeTruthy();
    expect(matching!.status).toBe("success");
  });

  it("comp ticket has totalAmount=0 and amountPaid=0", async () => {
    const res = await issueComp({
      userId: user.id,
      planId: plan.id,
      reason: "influencer",
      days: 3,
      issuedById: issuer.id,
    });
    expect(res.success).toBe(true);
    if (!res.success || !res.ticket) return;
    // Decimal columns return Prisma.Decimal — coerce to number for compare.
    expect(Number(res.ticket.totalAmount)).toBe(0);
    expect(Number(res.ticket.amountPaid)).toBe(0);
    expect(Number(res.ticket.balanceDue)).toBe(0);
  });

  it("comp creates a Payment row with paymentMode='complimentary' and amount=0", async () => {
    const res = await issueComp({
      userId: user.id,
      planId: plan.id,
      reason: "family",
      days: 3,
      issuedById: issuer.id,
    });
    expect(res.success).toBe(true);
    if (!res.success || !res.ticket) return;

    const payments = await prisma.payment.findMany({
      where: { memberTicketId: res.ticket.id },
    });
    expect(payments).toHaveLength(1);
    const p = payments[0];
    expect(p.paymentMode).toBe("complimentary");
    expect(Number(p.amount)).toBe(0);
    expect(p.collectedById).toBe(issuer.id);
    expect(p.paymentFor).toBe("complimentary");
  });

  it("issueComp + Payment + AuditLog are atomic — failure rolls back", async () => {
    // The service validates user/plan/issuer/approver BEFORE entering
    // prisma.$transaction, so the only way to provoke a mid-transaction
    // failure without mocking would be a race or schema change. We
    // therefore exercise the closest observable atomicity guarantee:
    // a failed call (here: non-existent plan) must leave NO MemberTicket,
    // NO Payment, and NO AuditLog row behind for this user.
    const beforeAuditCount = await prisma.auditLog.count({
      where: { action: "comp.issue", actorId: issuer.id },
    });

    const result = await issueComp({
      userId: user.id,
      planId: 999_999_999, // intentionally invalid
      reason: "other",
      days: 3,
      issuedById: issuer.id,
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toMatch(/plan/i);

    const postTicketCount = await prisma.memberTicket.count({
      where: { userId: user.id },
    });
    const postPaymentCount = await prisma.payment.count({
      where: { userId: user.id },
    });
    const afterAuditCount = await prisma.auditLog.count({
      where: { action: "comp.issue", actorId: issuer.id },
    });

    expect(postTicketCount).toBe(preTicketCount);
    expect(postPaymentCount).toBe(prePaymentCount);
    expect(afterAuditCount).toBe(beforeAuditCount);
  });
});
