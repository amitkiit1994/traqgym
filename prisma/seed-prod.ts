import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

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
