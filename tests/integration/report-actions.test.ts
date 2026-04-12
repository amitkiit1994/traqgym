/**
 * Integration tests for report query logic (P&L, Membership Matrix, Source Analysis).
 * Tests the underlying Prisma queries directly since server actions require auth context.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma, disconnectDb } from "../helpers/db";
import { cleanupTestData } from "../helpers/cleanup";

let location: any;
let plan1: any;
let plan2: any;
let user1: any;
let user2: any;
let worker: any;

const uid = `__test_rpt_${Date.now()}`;

beforeAll(async () => {
  location = await prisma.location.create({
    data: {
      name: `Test Location __test_${uid}`,
      code: uid.slice(-8).toUpperCase(),
      isActive: true,
    },
  });

  plan1 = await prisma.ticketPlan.create({
    data: {
      name: `Test Plan __test_${uid}_monthly`,
      price: 1500,
      expireDays: 30,
      isActive: true,
    },
  });

  plan2 = await prisma.ticketPlan.create({
    data: {
      name: `Test Plan __test_${uid}_quarterly`,
      price: 4000,
      expireDays: 90,
      isActive: true,
    },
  });

  worker = await prisma.worker.create({
    data: {
      email: `${uid}_worker@worker.test.local`,
      password: "$2b$10$fakehashfortesting000000000000000000000000000",
      firstname: "Report",
      lastname: "Worker",
      role: "admin",
      locationId: location.id,
    },
  });

  user1 = await prisma.user.create({
    data: {
      email: `${uid}_u1@test.local`,
      password: "$2b$10$fakehashfortesting000000000000000000000000000",
      firstname: "Report",
      lastname: "UserOne",
      phone: "9000100001",
      locationId: location.id,
    },
  });

  user2 = await prisma.user.create({
    data: {
      email: `${uid}_u2@test.local`,
      password: "$2b$10$fakehashfortesting000000000000000000000000000",
      firstname: "Report",
      lastname: "UserTwo",
      phone: "9000100002",
      locationId: location.id,
    },
  });
});

afterAll(async () => {
  // Clean in dependency order
  await prisma.payment.deleteMany({
    where: { user: { email: { contains: uid } } },
  });
  await prisma.expense.deleteMany({
    where: { locationId: location?.id },
  });
  await prisma.enquiry.deleteMany({
    where: { locationId: location?.id },
  });
  await prisma.memberTicket.deleteMany({
    where: { user: { email: { contains: uid } } },
  });
  await cleanupTestData();
  await disconnectDb();
});

describe("P&L Report queries", () => {
  it("returns revenue and expenses for a given month", async () => {
    // Create tickets, payments, and expenses in a known month
    const testDate = new Date(2025, 5, 15); // June 2025

    const ticket1 = await prisma.memberTicket.create({
      data: {
        userId: user1.id,
        planId: plan1.id,
        locationId: location.id,
        buyDate: testDate,
        expireDate: new Date(2025, 6, 15),
        status: "active",
        amountPaid: 1500,
        balanceDue: 0,
      },
    });

    await prisma.payment.create({
      data: {
        userId: user1.id,
        memberTicketId: ticket1.id,
        locationId: location.id,
        amount: 1500,
        paymentMode: "cash",
        collectedById: worker.id,
        createdAt: testDate,
      },
    });

    const ticket2 = await prisma.memberTicket.create({
      data: {
        userId: user2.id,
        planId: plan1.id,
        locationId: location.id,
        buyDate: testDate,
        expireDate: new Date(2025, 6, 15),
        status: "active",
        amountPaid: 1500,
        balanceDue: 0,
      },
    });

    await prisma.payment.create({
      data: {
        userId: user2.id,
        memberTicketId: ticket2.id,
        locationId: location.id,
        amount: 1500,
        paymentMode: "upi",
        collectedById: worker.id,
        createdAt: testDate,
      },
    });

    await prisma.expense.create({
      data: {
        category: "rent",
        description: "Test rent expense",
        amount: 500,
        expenseDate: testDate,
        locationId: location.id,
      },
    });

    await prisma.expense.create({
      data: {
        category: "utilities",
        description: "Test electricity",
        amount: 200,
        expenseDate: testDate,
        locationId: location.id,
      },
    });

    // Run the same queries the server action uses
    const from = new Date(2025, 5, 1);
    const to = new Date(2025, 5, 30, 23, 59, 59, 999);

    const payments = await prisma.payment.findMany({
      where: {
        createdAt: { gte: from, lte: to },
        locationId: location.id,
      },
    });

    const revenueByMode: Record<string, number> = {};
    let revenue = 0;
    for (const p of payments) {
      const amt = Number(p.amount);
      revenue += amt;
      revenueByMode[p.paymentMode] = (revenueByMode[p.paymentMode] ?? 0) + amt;
    }

    const expenseRows = await prisma.expense.findMany({
      where: {
        expenseDate: { gte: from, lte: to },
        locationId: location.id,
      },
    });

    const expensesByCategory: Record<string, number> = {};
    let expenses = 0;
    for (const e of expenseRows) {
      const amt = Number(e.amount);
      expenses += amt;
      expensesByCategory[e.category] = (expensesByCategory[e.category] ?? 0) + amt;
    }

    expect(revenue).toBe(3000);
    expect(expenses).toBe(700);
    expect(revenue - expenses).toBe(2300);
    expect(revenueByMode["cash"]).toBe(1500);
    expect(revenueByMode["upi"]).toBe(1500);
    expect(expensesByCategory["rent"]).toBe(500);
    expect(expensesByCategory["utilities"]).toBe(200);
  });

  it("returns zeros for empty months", async () => {
    // Query a month with no data
    const from = new Date(2020, 0, 1);
    const to = new Date(2020, 0, 31, 23, 59, 59, 999);

    const payments = await prisma.payment.findMany({
      where: {
        createdAt: { gte: from, lte: to },
        locationId: location.id,
      },
    });

    const expenseRows = await prisma.expense.findMany({
      where: {
        expenseDate: { gte: from, lte: to },
        locationId: location.id,
      },
    });

    expect(payments).toHaveLength(0);
    expect(expenseRows).toHaveLength(0);
  });
});

describe("Membership Matrix queries", () => {
  it("returns plan x status counts", async () => {
    const groups = await prisma.memberTicket.groupBy({
      by: ["planId", "status"],
      _count: true,
      where: { locationId: location.id },
    });

    const plans = await prisma.ticketPlan.findMany({
      where: { id: { in: groups.map((g) => g.planId) } },
    });
    const planMap = new Map(plans.map((p) => [p.id, p.name]));

    const matrix: Record<number, { planName: string; active: number; cancelled: number; total: number }> = {};
    for (const g of groups) {
      if (!matrix[g.planId]) {
        matrix[g.planId] = { planName: planMap.get(g.planId) ?? `Plan #${g.planId}`, active: 0, cancelled: 0, total: 0 };
      }
      if (g.status === "active") matrix[g.planId].active += g._count;
      else if (g.status === "cancelled") matrix[g.planId].cancelled += g._count;
      matrix[g.planId].total += g._count;
    }

    const rows = Object.values(matrix);
    // We created 2 active tickets on plan1 in previous test
    const plan1Row = rows.find((r) => r.planName.includes(uid));
    expect(plan1Row).toBeTruthy();
    expect(plan1Row!.active).toBeGreaterThanOrEqual(2);
    expect(plan1Row!.total).toBeGreaterThanOrEqual(2);
  });
});

describe("Source Analysis queries", () => {
  it("groups enquiries by source with conversion rates", async () => {
    // Create enquiries with different sources
    await prisma.enquiry.create({
      data: {
        name: "Test Enquiry 1",
        phone: "9000200001",
        source: "walk_in",
        locationId: location.id,
        convertedUserId: user1.id,
      },
    });

    await prisma.enquiry.create({
      data: {
        name: "Test Enquiry 2",
        phone: "9000200002",
        source: "walk_in",
        locationId: location.id,
        convertedUserId: null,
      },
    });

    await prisma.enquiry.create({
      data: {
        name: "Test Enquiry 3",
        phone: "9000200003",
        source: "referral",
        locationId: location.id,
        convertedUserId: user2.id,
      },
    });

    const totalGroups = await prisma.enquiry.groupBy({
      by: ["source"],
      _count: true,
      where: { locationId: location.id },
    });

    const convertedGroups = await prisma.enquiry.groupBy({
      by: ["source"],
      _count: true,
      where: { locationId: location.id, convertedUserId: { not: null } },
    });

    const convertedMap = new Map(convertedGroups.map((g) => [g.source, g._count]));

    const results = totalGroups.map((g) => {
      const total = g._count;
      const converted = convertedMap.get(g.source) ?? 0;
      return {
        source: g.source,
        total,
        converted,
        conversionRate: total > 0 ? Math.round((converted / total) * 10000) / 100 : 0,
      };
    });

    const walkIn = results.find((r) => r.source === "walk_in");
    expect(walkIn).toBeTruthy();
    expect(walkIn!.total).toBe(2);
    expect(walkIn!.converted).toBe(1);
    expect(walkIn!.conversionRate).toBe(50);

    const referral = results.find((r) => r.source === "referral");
    expect(referral).toBeTruthy();
    expect(referral!.total).toBe(1);
    expect(referral!.converted).toBe(1);
    expect(referral!.conversionRate).toBe(100);
  });

  it("handles zero conversions correctly", async () => {
    await prisma.enquiry.create({
      data: {
        name: "Test Enquiry NoConvert",
        phone: "9000200004",
        source: "social_media",
        locationId: location.id,
        convertedUserId: null,
      },
    });

    const totalGroups = await prisma.enquiry.groupBy({
      by: ["source"],
      _count: true,
      where: { locationId: location.id, source: "social_media" },
    });

    const convertedGroups = await prisma.enquiry.groupBy({
      by: ["source"],
      _count: true,
      where: { locationId: location.id, source: "social_media", convertedUserId: { not: null } },
    });

    expect(totalGroups).toHaveLength(1);
    expect(totalGroups[0]._count).toBe(1);
    expect(convertedGroups).toHaveLength(0);

    const converted = convertedGroups.find((g) => g.source === "social_media")?._count ?? 0;
    const rate = totalGroups[0]._count > 0 ? Math.round((converted / totalGroups[0]._count) * 10000) / 100 : 0;
    expect(rate).toBe(0);
  });
});
