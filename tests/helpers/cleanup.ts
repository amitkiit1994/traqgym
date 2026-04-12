/**
 * Cleanup utilities for integration tests.
 * Deletes test records created by factory functions (identified by `__test_` prefix).
 */
import { prisma } from "./db";

/**
 * Delete all records created by test factories.
 * Call this in `afterAll` of integration test suites.
 */
export async function cleanupTestData() {
  // Delete in dependency order (child tables first)
  await prisma.attendanceLog.deleteMany({
    where: { user: { email: { contains: "@test.local" } } },
  });
  await prisma.attendanceLog.deleteMany({
    where: { worker: { email: { contains: "@worker.test.local" } } },
  });
  await prisma.membershipFreeze.deleteMany({
    where: { user: { email: { contains: "@test.local" } } },
  });
  await prisma.payment.deleteMany({
    where: { user: { email: { contains: "@test.local" } } },
  });
  await prisma.invoice.deleteMany({
    where: { user: { email: { contains: "@test.local" } } },
  });
  await prisma.memberTicket.deleteMany({
    where: { user: { email: { contains: "@test.local" } } },
  });
  await prisma.giftCard.deleteMany({
    where: { code: { startsWith: "__TEST_" } },
  });
  await prisma.user.deleteMany({
    where: { email: { contains: "@test.local" } },
  });
  await prisma.worker.deleteMany({
    where: { email: { contains: "@worker.test.local" } },
  });
  await prisma.ticketPlan.deleteMany({
    where: { name: { startsWith: "Test Plan __test_" } },
  });
  await prisma.location.deleteMany({
    where: { name: { startsWith: "Test Location __test_" } },
  });
}

/**
 * Delete specific records by ID. Use for targeted cleanup.
 */
export async function cleanupByIds(table: string, ids: number[]) {
  if (ids.length === 0) return;
  await (prisma as any)[table].deleteMany({
    where: { id: { in: ids } },
  });
}
