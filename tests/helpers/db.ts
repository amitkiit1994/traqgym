/**
 * Direct Prisma client for integration tests.
 * Uses the same DATABASE_URL as the dev server.
 */
import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient();

/**
 * Disconnect Prisma after test suite completes.
 */
export async function disconnectDb() {
  await prisma.$disconnect();
}
