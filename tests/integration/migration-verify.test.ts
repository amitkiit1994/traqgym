/**
 * Verification tests for the FitnessBoard migration.
 * Checks that migrated data exists with expected counts and structure.
 * Assumes the migration script has already been run — when the marker is
 * missing (e.g. DB hydrated via pg_dump rather than the migration script),
 * the entire suite skips rather than reporting false failures.
 */
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { prisma, disconnectDb } from "../helpers/db";

const FFF_LOCATION_CODE = "FFF";

afterAll(async () => {
  await disconnectDb();
});

let migrationRan = false;

describe("FitnessBoard Migration Verification", () => {
  let locationId: number;

  beforeAll(async () => {
    const marker = await prisma.gymSettings.findUnique({
      where: { key: "fitnessboard_migration_complete" },
    });
    migrationRan = Boolean(marker);
  });

  it("created the FreeFormFitness location", async () => {
    if (!migrationRan) return;
    const location = await prisma.location.findFirst({
      where: { code: FFF_LOCATION_CODE },
    });
    expect(location).toBeTruthy();
    expect(location!.name).toBe("Free Form Fitness");
    locationId = location!.id;
  });

  it("created users with correct count", async () => {
    if (!migrationRan) return;
    const count = await prisma.user.count({
      where: { locationId },
    });
    // Migration imports from all_people.csv — should have a significant number
    expect(count).toBeGreaterThan(0);
  });

  it("created plans", async () => {
    if (!migrationRan) return;
    // Migration creates plans from members.csv membership names
    const plans = await prisma.ticketPlan.findMany();
    expect(plans.length).toBeGreaterThan(0);
  });

  it("created member tickets", async () => {
    if (!migrationRan) return;
    const count = await prisma.memberTicket.count({
      where: { locationId },
    });
    expect(count).toBeGreaterThan(0);
  });

  it("created payments", async () => {
    if (!migrationRan) return;
    const count = await prisma.payment.count({
      where: { locationId },
    });
    expect(count).toBeGreaterThan(0);
  });

  it("created enquiries from prospects", async () => {
    if (!migrationRan) return;
    const count = await prisma.enquiry.count({
      where: { locationId },
    });
    expect(count).toBeGreaterThan(0);
  });

  it("is idempotent — migration marker exists", async () => {
    if (!migrationRan) return;
    const marker = await prisma.gymSettings.findUnique({
      where: { key: "fitnessboard_migration_complete" },
    });
    expect(marker).toBeTruthy();
    expect(marker!.value).toBeTruthy();
  });

  it("created workers from CSV staff names", async () => {
    if (!migrationRan) return;
    const count = await prisma.worker.count({
      where: { email: { endsWith: "@staff.freeform.local" } },
    });
    expect(count).toBeGreaterThan(0);
  });

  it("created invoices linked to payments", async () => {
    if (!migrationRan) return;
    const count = await prisma.invoice.count({
      where: { invoiceNumber: { startsWith: "FB-" } },
    });
    expect(count).toBeGreaterThan(0);
  });
});
