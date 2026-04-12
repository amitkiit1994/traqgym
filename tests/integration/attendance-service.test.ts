/**
 * Integration tests for lib/services/attendance.ts
 * Tests checkIn, checkOut against a real database.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { checkIn, checkOut } from "@/lib/services/attendance";
import { prisma, disconnectDb } from "../helpers/db";
import { cleanupTestData } from "../helpers/cleanup";

let user: any;
let worker: any;
let location: any;
let plan: any;
let activeTicket: any;
let expiredUser: any;

beforeAll(async () => {
  // Create isolated test data directly with correct schema fields
  const uid = `__test_att_${Date.now()}`;

  user = await prisma.user.create({
    data: {
      email: `${uid}_user@test.local`,
      password: "$2b$10$fakehashfortesting000000000000000000000000000",
      firstname: "Test",
      lastname: "Member",
      phone: "9000000001",
    },
  });

  expiredUser = await prisma.user.create({
    data: {
      email: `${uid}_expired@test.local`,
      password: "$2b$10$fakehashfortesting000000000000000000000000000",
      firstname: "Expired",
      lastname: "Member",
      phone: "9000000002",
    },
  });

  worker = await prisma.worker.create({
    data: {
      email: `${uid}_worker@worker.test.local`,
      password: "$2b$10$fakehashfortesting000000000000000000000000000",
      firstname: "Test",
      lastname: "Worker",
      role: "staff",
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

  // Active ticket for user (expires 30 days from now)
  activeTicket = await prisma.memberTicket.create({
    data: {
      userId: user.id,
      planId: plan.id,
      locationId: location.id,
      buyDate: new Date(),
      expireDate: new Date(Date.now() + 30 * 86400000),
      status: "active",
      amountPaid: 1000,
      balanceDue: 0,
    },
  });

  // Expired ticket for expiredUser (expired 10 days ago)
  await prisma.memberTicket.create({
    data: {
      userId: expiredUser.id,
      planId: plan.id,
      locationId: location.id,
      buyDate: new Date(Date.now() - 40 * 86400000),
      expireDate: new Date(Date.now() - 10 * 86400000),
      status: "active",
      amountPaid: 1000,
      balanceDue: 0,
    },
  });
});

afterAll(async () => {
  await cleanupTestData();
  await disconnectDb();
});

describe("attendance service", () => {
  it("checkIn() happy path — creates attendance record for active member", async () => {
    const result = await checkIn({
      userId: user.id,
      locationId: location.id,
      source: "test",
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.existing).toBe(false);
    expect(result.id).toBeGreaterThan(0);

    // Verify record in DB
    const record = await prisma.attendanceLog.findUnique({
      where: { id: result.id },
    });
    expect(record).toBeTruthy();
    expect(record!.userId).toBe(user.id);
    expect(record!.locationId).toBe(location.id);
    expect(record!.checkIn).toBeTruthy();
    expect(record!.checkOut).toBeNull();
  });

  it("duplicate checkIn same day/location returns existing record, no duplicate created", async () => {
    // The first checkIn was already done in the previous test
    const result = await checkIn({
      userId: user.id,
      locationId: location.id,
      source: "test",
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.existing).toBe(true);

    // Verify only one record exists for this user/location/today
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const count = await prisma.attendanceLog.count({
      where: {
        userId: user.id,
        locationId: location.id,
        attendanceDate: {
          gte: new Date(today.getFullYear(), today.getMonth(), today.getDate()),
          lt: new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1),
        },
      },
    });
    expect(count).toBe(1);
  });

  it("expired membership is rejected", async () => {
    const result = await checkIn({
      userId: expiredUser.id,
      locationId: location.id,
      source: "test",
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toBe("Membership expired");
  });

  it("worker checkIn succeeds without membership check", async () => {
    const result = await checkIn({
      workerId: worker.id,
      locationId: location.id,
      source: "test",
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.existing).toBe(false);
    expect(result.id).toBeGreaterThan(0);

    // Verify worker attendance record
    const record = await prisma.attendanceLog.findUnique({
      where: { id: result.id },
    });
    expect(record).toBeTruthy();
    expect(record!.workerId).toBe(worker.id);
    expect(record!.userId).toBeNull();
  });

  it("checkOut happy path — sets checkOut time on open record", async () => {
    const result = await checkOut({
      userId: user.id,
      locationId: location.id,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;

    // Verify checkOut was set
    const record = await prisma.attendanceLog.findUnique({
      where: { id: result.id },
    });
    expect(record).toBeTruthy();
    expect(record!.checkOut).toBeTruthy();
  });
});
