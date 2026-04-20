import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

// Default POS catalog — keep in sync with prisma/seed.ts. Idempotent: re-runs
// skip products that already exist (matched by name). We do not overwrite
// price/stock so manual catalog tweaks survive a re-seed.
const DEFAULT_POS_PRODUCTS: Array<{
  name: string;
  price: number;
  stock: number;
  category: string;
}> = [
  { name: "Whey Protein 1kg", price: 2499, stock: 10, category: "supplement" },
  { name: "Mass Gainer 1kg", price: 1899, stock: 10, category: "supplement" },
  { name: "Pre-workout 300g", price: 1799, stock: 10, category: "supplement" },
  { name: "Protein Bar", price: 120, stock: 50, category: "snack" },
  { name: "Energy Gel", price: 80, stock: 50, category: "snack" },
  { name: "Glucose Sachet", price: 20, stock: 100, category: "snack" },
  { name: "Water Bottle 1L", price: 150, stock: 30, category: "accessory" },
  { name: "Shaker", price: 250, stock: 20, category: "accessory" },
  { name: "Hand Towel", price: 350, stock: 20, category: "accessory" },
  { name: "Wrist Wraps", price: 399, stock: 15, category: "gear" },
  { name: "Lifting Belt", price: 999, stock: 10, category: "gear" },
  { name: "Resistance Band", price: 599, stock: 15, category: "gear" },
];

async function seedPosProducts() {
  let created = 0;
  let skipped = 0;
  for (const p of DEFAULT_POS_PRODUCTS) {
    const existing = await prisma.product.findFirst({ where: { name: p.name } });
    if (existing) {
      skipped++;
      continue;
    }
    await prisma.product.create({ data: p });
    created++;
  }
  console.log(`POS products: ${created} created, ${skipped} already existed`);
}

async function main() {
  const email = process.env.ADMIN_EMAIL || "admin@gym.com";
  const password = process.env.ADMIN_PASSWORD || "password123";
  const gymName = process.env.NEXT_PUBLIC_GYM_NAME || process.env.GYM_NAME || "TraqGym";

  const hash = await bcrypt.hash(password, 10);

  // Create default location
  const location = await prisma.location.upsert({
    where: { code: "MAIN" },
    update: {},
    create: { name: gymName, code: "MAIN", address: "", phone: "", isActive: true },
  });

  // Create admin worker
  const existing = await prisma.worker.findUnique({ where: { email } });
  if (existing) {
    console.log(`Admin already exists: ${email}`);
  } else {
    await prisma.worker.create({
      data: { email, password: hash, firstname: "Admin", lastname: "", role: "admin", locationId: location.id, isActive: true },
    });
    console.log(`Admin created: ${email} / ${password}`);
  }

  // Opening hours (Mon-Sat 6:00-22:00, Sun closed)
  const existingHours = await prisma.openingHour.count({ where: { locationId: location.id } });
  if (existingHours === 0) {
    for (let day = 0; day <= 6; day++) {
      await prisma.openingHour.create({
        data: {
          locationId: location.id, dayOfWeek: day,
          openTime: day === 0 ? "00:00" : "06:00",
          closeTime: day === 0 ? "00:00" : "22:00",
          isClosed: day === 0,
        },
      });
    }
  }

  // Default settings
  const settings = [
    { key: "grace_period_days", value: "7" },
    { key: "auto_checkout_enabled", value: "true" },
    { key: "gym_name", value: gymName },
  ];
  for (const s of settings) {
    await prisma.gymSettings.upsert({
      where: { key: s.key },
      update: {},
      create: s,
    });
  }

  // Default POS catalog so /admin/pos is usable on a fresh instance
  await seedPosProducts();

  console.log("Production seed completed");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
