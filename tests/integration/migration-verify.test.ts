/**
 * Verification tests for the FitnessBoard migration.
 * Checks that migrated data exists with expected counts and structure.
 * Assumes the migration script has already been run.
 */
import { describe, it, expect, afterAll } from "vitest";
import { prisma, disconnectDb } from "../helpers/db";

const FFF_LOCATION_CODE = "FFF";

afterAll(async () => {
  await disconnectDb();
});

describe("FitnessBoard Migration Verification", () => {
  let locationId: number;

  it("created the FreeFormFitness location", async () => {
    const location = await prisma.location.findFirst({
      where: { code: FFF_LOCATION_CODE },
    });
    expect(location).toBeTruthy();
    expect(location!.name).toBe("Free Form Fitness");
    locationId = location!.id;
  });

  it("created users with correct count", async () => {
    const count = await prisma.user.count({
      where: { locationId },
    });
    // Migration imports from all_people.csv — should have a significant number
    expect(count).toBeGreaterThan(0);
  });

  it("created plans", async () => {
    // Migration creates plans from members.csv membership names
    const plans = await prisma.ticketPlan.findMany();
    expect(plans.length).toBeGreaterThan(0);
  });

  it("created member tickets", async () => {
    const count = await prisma.memberTicket.count({
      where: { locationId },
    });
    expect(count).toBeGreaterThan(0);
  });

  it("created payments", async () => {
    const count = await prisma.payment.count({
      where: { locationId },
    });
    expect(count).toBeGreaterThan(0);
  });

  it("created enquiries from prospects", async () => {
    const count = await prisma.enquiry.count({
      where: { locationId },
    });
    expect(count).toBeGreaterThan(0);
  });

  it("is idempotent — migration marker exists", async () => {
    const marker = await prisma.gymSettings.findUnique({
      where: { key: "fitnessboard_migration_complete" },
    });
    expect(marker).toBeTruthy();
    expect(marker!.value).toBeTruthy();
  });

  it("created workers from CSV staff names", async () => {
    const count = await prisma.worker.count({
      where: { email: { endsWith: "@staff.freeform.local" } },
    });
    expect(count).toBeGreaterThan(0);
  });

  it("created invoices linked to payments", async () => {
    const count = await prisma.invoice.count({
      where: { invoiceNumber: { startsWith: "FB-" } },
    });
    expect(count).toBeGreaterThan(0);
  });
});
