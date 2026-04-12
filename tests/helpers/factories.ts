/**
 * Factory functions for creating isolated test data.
 * All test records use a `__test_` prefix for easy cleanup.
 */
import { prisma } from "./db";

let counter = 0;
function uid() {
  return `__test_${Date.now()}_${++counter}`;
}

export async function createTestUser(overrides: Record<string, any> = {}) {
  const id = uid();
  return prisma.user.create({
    data: {
      firstname: overrides.firstname ?? `TestFirst${counter}`,
      lastname: overrides.lastname ?? `TestLast${counter}`,
      email: overrides.email ?? `${id}@test.local`,
      phone: overrides.phone ?? `9000${String(counter).padStart(6, "0")}`,
      password: overrides.password ?? "hashedpassword123",
      ...overrides,
    },
  });
}

export async function createTestWorker(overrides: Record<string, any> = {}) {
  const id = uid();
  return prisma.worker.create({
    data: {
      firstname: overrides.firstname ?? `WorkerFirst${counter}`,
      lastname: overrides.lastname ?? `WorkerLast${counter}`,
      email: overrides.email ?? `${id}@worker.test.local`,
      password: overrides.password ?? "hashedpassword123",
      role: overrides.role ?? "staff",
      ...overrides,
    },
  });
}

export async function createTestPlan(overrides: Record<string, any> = {}) {
  const id = uid();
  return prisma.ticketPlan.create({
    data: {
      name: overrides.name ?? `Test Plan ${id}`,
      price: overrides.price ?? 1000,
      expireDays: overrides.expireDays ?? 30,
      isActive: overrides.isActive ?? true,
      ...overrides,
    },
  });
}

export async function createTestLocation(overrides: Record<string, any> = {}) {
  const id = uid();
  return prisma.location.create({
    data: {
      name: overrides.name ?? `Test Location ${id}`,
      code: overrides.code ?? id.slice(-8).toUpperCase(),
      isActive: overrides.isActive ?? true,
      ...overrides,
    },
  });
}

export async function createTestTicket(overrides: Record<string, any> = {}) {
  return prisma.memberTicket.create({
    data: {
      userId: overrides.userId,
      planId: overrides.planId,
      locationId: overrides.locationId,
      buyDate: overrides.buyDate ?? new Date(),
      expireDate: overrides.expireDate ?? new Date(Date.now() + 30 * 86400000),
      status: overrides.status ?? "active",
      totalAmount: overrides.totalAmount ?? 1000,
      amountPaid: overrides.amountPaid ?? 1000,
      balanceDue: overrides.balanceDue ?? 0,
      ...overrides,
    },
  });
}

export async function createTestGiftCard(overrides: Record<string, any> = {}) {
  const id = uid();
  return prisma.giftCard.create({
    data: {
      code: overrides.code ?? id.slice(-8).toUpperCase(),
      amount: overrides.amount ?? 500,
      balance: overrides.balance ?? overrides.amount ?? 500,
      status: overrides.status ?? "active",
      purchaserId: overrides.purchaserId ?? null,
      ...overrides,
    },
  });
}
