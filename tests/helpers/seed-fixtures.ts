/**
 * Idempotent test-fixture upsert.
 *
 * Layers the SEED demo accounts/plans/tickets on top of whatever data is
 * already in the database — never deletes. Designed for local DBs that hold
 * imported FFF/EGYM production data alongside the demo fixtures the e2e and
 * integration tests assume.
 *
 * Identification strategy (all keys idempotent across runs):
 *   - Location  → unique `code` ("MAIN", "CC")
 *   - Worker    → unique `email` ("admin@gym.com", "staff@gym.com")
 *   - User      → unique `email` ("memberN@test.com")
 *   - TicketPlan→ name suffix " (test fixture)" + findFirst-then-create
 *   - MemberTicket → `externalRef` set to "TEST_FIXTURE_member{N}"
 *   - GymClass  → name + locationId composite, findFirst-then-create
 *   - PromoCode → unique `code`
 *   - Enquiry   → name + phone composite, findFirst-then-create
 *   - GymSettings → unique `key`
 *
 * The SEED constant in tests/e2e/helpers.ts is populated by reading the JSON
 * file written by writeSeedFixturesJson() (see tests/global-setup.ts).
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { writeFileSync, mkdirSync } from "fs";
import path from "path";

export type SeedShape = {
  admin: { email: string; password: string; id: number };
  staff: { email: string; password: string; id: number };
  members: {
    active20d: { email: string; password: string; id: number; phone: string; name: string };
    expiring3d: { email: string; password: string; id: number; phone: string; name: string };
    expired5d: { email: string; password: string; id: number; phone: string; name: string };
    activeAnnual: { email: string; password: string; id: number; phone: string; name: string };
    noTicket: { email: string; password: string; id: number; phone: string; name: string };
  };
  locations: {
    main: { id: number; name: string; code: string };
    cc: { id: number; name: string; code: string };
  };
  plans: {
    monthly: { id: number; name: string; price: number; days: number };
    quarterly: { id: number; name: string; price: number; days: number };
    annual: { id: number; name: string; price: number; days: number };
  };
  tickets: {
    member1: { id: number; userId: number; planId: number };
    member2: { id: number; userId: number; planId: number };
    member3: { id: number; userId: number; planId: number };
    member4: { id: number; userId: number; planId: number };
  };
  classes: {
    yoga: { id: number; name: string; capacity: number };
    zumba: { id: number; name: string; capacity: number };
  };
  promos: {
    welcome20: { code: string; discountType: string; discountValue: number };
    summer10: { code: string; isActive: boolean };
  };
  enquiries: {
    new: { id: number; name: string; phone: string };
    followUp: { id: number; name: string; phone: string };
    converted: { id: number; name: string; phone: string };
  };
  gracePeriodDays: number;
};

const FIXTURE_TAG = "TEST_FIXTURE";

function daysFromNow(d: number): Date {
  const dt = new Date();
  dt.setDate(dt.getDate() + d);
  return dt;
}

async function upsertWorker(
  prisma: PrismaClient,
  email: string,
  firstname: string,
  lastname: string,
  role: "admin" | "staff",
  locationId: number,
  passwordHash: string,
) {
  return prisma.worker.upsert({
    where: { email },
    update: { isActive: true, role, locationId, password: passwordHash },
    create: { email, password: passwordHash, firstname, lastname, role, locationId, isActive: true },
  });
}

async function upsertMember(
  prisma: PrismaClient,
  email: string,
  phone: string,
  firstname: string,
  lastname: string,
  locationId: number,
  passwordHash: string,
) {
  return prisma.user.upsert({
    where: { email },
    update: { isActive: true, phone, firstname, lastname, locationId, password: passwordHash },
    create: { email, password: passwordHash, firstname, lastname, phone, locationId, isActive: true },
  });
}

async function upsertPlan(
  prisma: PrismaClient,
  baseName: string,
  expireDays: number,
  price: number,
) {
  const name = `${baseName} (test fixture)`;
  const existing = await prisma.ticketPlan.findFirst({ where: { name } });
  if (existing) {
    return prisma.ticketPlan.update({
      where: { id: existing.id },
      data: { expireDays, price, isActive: true },
    });
  }
  return prisma.ticketPlan.create({
    data: { name, expireDays, price, isActive: true },
  });
}

async function upsertTicket(
  prisma: PrismaClient,
  refKey: string,
  userId: number,
  planId: number,
  locationId: number,
  buyDate: Date,
  expireDate: Date,
  totalAmount: number,
) {
  const externalRef = `${FIXTURE_TAG}_${refKey}`;
  const existing = await prisma.memberTicket.findFirst({ where: { externalRef } });
  if (existing) {
    return prisma.memberTicket.update({
      where: { id: existing.id },
      data: {
        userId,
        planId,
        locationId,
        buyDate,
        expireDate,
        status: "active",
        totalAmount,
        amountPaid: totalAmount,
        balanceDue: 0,
      },
    });
  }
  return prisma.memberTicket.create({
    data: {
      userId,
      planId,
      locationId,
      buyDate,
      expireDate,
      status: "active",
      totalAmount,
      amountPaid: totalAmount,
      balanceDue: 0,
      externalRef,
    },
  });
}

async function upsertClass(
  prisma: PrismaClient,
  name: string,
  locationId: number,
  maxCapacity: number,
  instructorId: number,
) {
  const existing = await prisma.gymClass.findFirst({ where: { name, locationId } });
  if (existing) {
    return prisma.gymClass.update({
      where: { id: existing.id },
      data: { maxCapacity, isActive: true, instructorId },
    });
  }
  return prisma.gymClass.create({
    data: { name, locationId, maxCapacity, isActive: true, instructorId },
  });
}

async function upsertPromo(
  prisma: PrismaClient,
  code: string,
  discountType: string,
  discountValue: number,
  isActive: boolean,
) {
  const farPast = new Date("2020-01-01");
  const farFuture = new Date("2099-12-31");
  return prisma.promoCode.upsert({
    where: { code },
    update: { discountType, discountValue, isActive, validFrom: farPast, validTo: farFuture },
    create: { code, discountType, discountValue, isActive, validFrom: farPast, validTo: farFuture },
  });
}

async function upsertEnquiry(
  prisma: PrismaClient,
  name: string,
  phone: string,
  status: string,
  locationId: number,
) {
  const existing = await prisma.enquiry.findFirst({ where: { name, phone } });
  if (existing) {
    return prisma.enquiry.update({
      where: { id: existing.id },
      data: { status, locationId },
    });
  }
  return prisma.enquiry.create({
    data: { name, phone, status, locationId, source: "walk_in" },
  });
}

async function upsertGracePeriod(prisma: PrismaClient, days: number) {
  await prisma.gymSettings.upsert({
    where: { key: "grace_period_days" },
    update: { value: String(days) },
    create: { key: "grace_period_days", value: String(days) },
  });
}

export async function loadSeedFixtures(prisma: PrismaClient): Promise<SeedShape> {
  const passwordHash = await bcrypt.hash("password123", 10);

  // Locations
  const main = await prisma.location.upsert({
    where: { code: "MAIN" },
    update: { name: "Main Branch", isActive: true },
    create: { name: "Main Branch", code: "MAIN", isActive: true },
  });
  const cc = await prisma.location.upsert({
    where: { code: "CC" },
    update: { name: "City Center", isActive: true },
    create: { name: "City Center", code: "CC", isActive: true },
  });

  // Workers
  const admin = await upsertWorker(prisma, "admin@gym.com", "Admin", "User", "admin", main.id, passwordHash);
  const staff = await upsertWorker(prisma, "staff@gym.com", "Staff", "User", "staff", main.id, passwordHash);

  // Members
  const m1 = await upsertMember(prisma, "member1@test.com", "9111111111", "Rahul", "Sharma", main.id, passwordHash);
  const m2 = await upsertMember(prisma, "member2@test.com", "9222222222", "Priya", "Patel", main.id, passwordHash);
  const m3 = await upsertMember(prisma, "member3@test.com", "9333333333", "Amit", "Kumar", main.id, passwordHash);
  const m4 = await upsertMember(prisma, "member4@test.com", "9444444444", "Sneha", "Reddy", main.id, passwordHash);
  const m5 = await upsertMember(prisma, "member5@test.com", "9555555555", "Vikram", "Singh", main.id, passwordHash);

  // Plans (use suffix so we don't clobber FFF/EGYM imported plans of same name)
  const monthly = await upsertPlan(prisma, "Monthly", 30, 1500);
  const quarterly = await upsertPlan(prisma, "Quarterly", 90, 4000);
  const annual = await upsertPlan(prisma, "Annual", 365, 12000);

  // Tickets — each member gets the state their test name implies
  // member1: active 20 days remaining (bought 10d ago, expires in 20d) on monthly
  const t1 = await upsertTicket(
    prisma,
    "member1",
    m1.id,
    monthly.id,
    main.id,
    daysFromNow(-10),
    daysFromNow(20),
    1500,
  );
  // member2: expiring in 3d on quarterly (bought 87d ago)
  const t2 = await upsertTicket(
    prisma,
    "member2",
    m2.id,
    quarterly.id,
    main.id,
    daysFromNow(-87),
    daysFromNow(3),
    4000,
  );
  // member3: expired 5 days ago (still in 7-day grace) on monthly
  const t3 = await upsertTicket(
    prisma,
    "member3",
    m3.id,
    monthly.id,
    main.id,
    daysFromNow(-35),
    daysFromNow(-5),
    1500,
  );
  // member4: active annual (bought 30d ago, 335d remaining)
  const t4 = await upsertTicket(
    prisma,
    "member4",
    m4.id,
    annual.id,
    main.id,
    daysFromNow(-30),
    daysFromNow(335),
    12000,
  );
  // member5: noTicket — intentionally has no fixture ticket created

  // Classes (instructor = staff worker so foreign key resolves)
  const yoga = await upsertClass(prisma, "Morning Yoga", main.id, 15, staff.id);
  const zumba = await upsertClass(prisma, "Evening Zumba", main.id, 20, staff.id);

  // Promos
  await upsertPromo(prisma, "WELCOME20", "percentage", 20, true);
  await upsertPromo(prisma, "SUMMER10", "percentage", 10, false);

  // Enquiries
  const eq1 = await upsertEnquiry(prisma, "Ravi Verma", "9666666666", "new", main.id);
  const eq2 = await upsertEnquiry(prisma, "Deepa Nair", "9777777777", "contacted", main.id);
  const eq3 = await upsertEnquiry(prisma, "Karan Mehta", "9888888888", "converted", main.id);

  // Grace period setting consumed by kiosk grace logic
  await upsertGracePeriod(prisma, 7);

  return {
    admin: { email: admin.email, password: "password123", id: admin.id },
    staff: { email: staff.email, password: "password123", id: staff.id },
    members: {
      active20d: { email: m1.email, password: "password123", id: m1.id, phone: m1.phone!, name: `${m1.firstname} ${m1.lastname}` },
      expiring3d: { email: m2.email, password: "password123", id: m2.id, phone: m2.phone!, name: `${m2.firstname} ${m2.lastname}` },
      expired5d: { email: m3.email, password: "password123", id: m3.id, phone: m3.phone!, name: `${m3.firstname} ${m3.lastname}` },
      activeAnnual: { email: m4.email, password: "password123", id: m4.id, phone: m4.phone!, name: `${m4.firstname} ${m4.lastname}` },
      noTicket: { email: m5.email, password: "password123", id: m5.id, phone: m5.phone!, name: `${m5.firstname} ${m5.lastname}` },
    },
    locations: {
      main: { id: main.id, name: main.name, code: main.code },
      cc: { id: cc.id, name: cc.name, code: cc.code },
    },
    plans: {
      monthly: { id: monthly.id, name: monthly.name, price: Number(monthly.price), days: monthly.expireDays },
      quarterly: { id: quarterly.id, name: quarterly.name, price: Number(quarterly.price), days: quarterly.expireDays },
      annual: { id: annual.id, name: annual.name, price: Number(annual.price), days: annual.expireDays },
    },
    tickets: {
      member1: { id: t1.id, userId: m1.id, planId: monthly.id },
      member2: { id: t2.id, userId: m2.id, planId: quarterly.id },
      member3: { id: t3.id, userId: m3.id, planId: monthly.id },
      member4: { id: t4.id, userId: m4.id, planId: annual.id },
    },
    classes: {
      yoga: { id: yoga.id, name: yoga.name, capacity: yoga.maxCapacity },
      zumba: { id: zumba.id, name: zumba.name, capacity: zumba.maxCapacity },
    },
    promos: {
      welcome20: { code: "WELCOME20", discountType: "percentage", discountValue: 20 },
      summer10: { code: "SUMMER10", isActive: false },
    },
    enquiries: {
      new: { id: eq1.id, name: eq1.name, phone: eq1.phone },
      followUp: { id: eq2.id, name: eq2.name, phone: eq2.phone },
      converted: { id: eq3.id, name: eq3.name, phone: eq3.phone },
    },
    gracePeriodDays: 7,
  };
}

export const SEED_FIXTURE_PATH = path.resolve(process.cwd(), "tests", ".seed-fixtures.json");

export function writeSeedFixturesJson(seed: SeedShape) {
  mkdirSync(path.dirname(SEED_FIXTURE_PATH), { recursive: true });
  writeFileSync(SEED_FIXTURE_PATH, JSON.stringify(seed, null, 2), "utf8");
}
