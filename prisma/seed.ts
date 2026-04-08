import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

function daysFromNow(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
}

function daysAgo(days: number): Date {
  return daysFromNow(-days);
}

function todayDate(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

async function main() {
  // Clear existing data
  await prisma.auditLog.deleteMany();
  await prisma.notificationLog.deleteMany();
  await prisma.rawAttendanceEvent.deleteMany();
  await prisma.biometricSyncRun.deleteMany();
  await prisma.deviceUserMapping.deleteMany();
  await prisma.biometricDevice.deleteMany();
  await prisma.attendanceLog.deleteMany();
  await prisma.invoice.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.memberTicket.deleteMany();
  await prisma.openingHour.deleteMany();
  await prisma.ticketPlan.deleteMany();
  await prisma.user.deleteMany();
  await prisma.worker.deleteMany();
  await prisma.location.deleteMany();

  const hash = await bcrypt.hash("password123", 10);

  // Locations
  const main = await prisma.location.create({
    data: { name: "Main Branch", code: "MAIN", address: "123 Fitness Road", phone: "9876543210", isActive: true },
  });
  const cc = await prisma.location.create({
    data: { name: "City Center", code: "CC", address: "456 Downtown Ave", phone: "9876543211", isActive: true },
  });

  // Plans
  const monthly = await prisma.ticketPlan.create({
    data: { name: "Monthly", expireDays: 30, price: 1500, isActive: true },
  });
  const quarterly = await prisma.ticketPlan.create({
    data: { name: "Quarterly", expireDays: 90, price: 4000, isActive: true },
  });
  const annual = await prisma.ticketPlan.create({
    data: { name: "Annual", expireDays: 365, price: 12000, isActive: true },
  });

  // Workers
  const admin = await prisma.worker.create({
    data: { email: "admin@gym.com", password: hash, firstname: "Admin", lastname: "User", role: "admin", locationId: main.id, isActive: true },
  });
  const staff = await prisma.worker.create({
    data: { email: "staff@gym.com", password: hash, firstname: "Staff", lastname: "Member", role: "staff", locationId: main.id, isActive: true },
  });

  // Members
  const member1 = await prisma.user.create({
    data: { email: "member1@test.com", password: hash, firstname: "Rahul", lastname: "Sharma", phone: "9111111111", locationId: main.id },
  });
  const member2 = await prisma.user.create({
    data: { email: "member2@test.com", password: hash, firstname: "Priya", lastname: "Patel", phone: "9222222222", locationId: main.id },
  });
  const member3 = await prisma.user.create({
    data: { email: "member3@test.com", password: hash, firstname: "Amit", lastname: "Kumar", phone: "9333333333", locationId: cc.id },
  });
  const member4 = await prisma.user.create({
    data: { email: "member4@test.com", password: hash, firstname: "Sneha", lastname: "Reddy", phone: "9444444444", locationId: cc.id },
  });
  const member5 = await prisma.user.create({
    data: { email: "member5@test.com", password: hash, firstname: "Vikram", lastname: "Singh", phone: "9555555555", locationId: main.id },
  });

  // Tickets
  // Member 1: active monthly, expires in 20 days
  const ticket1 = await prisma.memberTicket.create({
    data: { userId: member1.id, planId: monthly.id, locationId: main.id, buyDate: daysAgo(10), expireDate: daysFromNow(20) },
  });
  // Member 2: active quarterly, expires in 3 days (triggers reminder)
  const ticket2 = await prisma.memberTicket.create({
    data: { userId: member2.id, planId: quarterly.id, locationId: main.id, buyDate: daysAgo(87), expireDate: daysFromNow(3) },
  });
  // Member 3: expired 5 days ago
  const ticket3 = await prisma.memberTicket.create({
    data: { userId: member3.id, planId: monthly.id, locationId: cc.id, buyDate: daysAgo(35), expireDate: daysAgo(5) },
  });
  // Member 4: active annual, expires in 200 days
  const ticket4 = await prisma.memberTicket.create({
    data: { userId: member4.id, planId: annual.id, locationId: cc.id, buyDate: daysAgo(165), expireDate: daysFromNow(200) },
  });
  // Member 5: no ticket

  // Payments
  const payment1 = await prisma.payment.create({
    data: {
      userId: member1.id, memberTicketId: ticket1.id, locationId: main.id,
      amount: 1500, paymentMode: "cash", collectedById: admin.id,
      oldExpiryDate: null, newExpiryDate: daysFromNow(20),
    },
  });
  const payment2 = await prisma.payment.create({
    data: {
      userId: member2.id, memberTicketId: ticket2.id, locationId: main.id,
      amount: 4000, paymentMode: "upi", upiReference: "UPI123456789",
      collectedById: staff.id, oldExpiryDate: null, newExpiryDate: daysFromNow(3),
    },
  });
  const payment3 = await prisma.payment.create({
    data: {
      userId: member3.id, memberTicketId: ticket3.id, locationId: cc.id,
      amount: 1500, paymentMode: "cash", collectedById: admin.id,
      oldExpiryDate: null, newExpiryDate: daysAgo(5),
    },
  });
  const payment4 = await prisma.payment.create({
    data: {
      userId: member4.id, memberTicketId: ticket4.id, locationId: cc.id,
      amount: 12000, paymentMode: "upi", upiReference: "UPI987654321",
      collectedById: admin.id, oldExpiryDate: null, newExpiryDate: daysFromNow(200),
    },
  });

  // Invoices (rows only, no PDFs)
  await prisma.invoice.createMany({
    data: [
      { userId: member1.id, paymentId: payment1.id, invoiceNumber: "INV-2026-0001", route: "", status: "paid" },
      { userId: member2.id, paymentId: payment2.id, invoiceNumber: "INV-2026-0002", route: "", status: "paid" },
      { userId: member3.id, paymentId: payment3.id, invoiceNumber: "INV-2026-0003", route: "", status: "paid" },
      { userId: member4.id, paymentId: payment4.id, invoiceNumber: "INV-2026-0004", route: "", status: "paid" },
    ],
  });

  // Attendance (10 rows across last 7 days for members 1-3)
  for (let d = 0; d < 7; d++) {
    const date = daysAgo(d);
    const dateOnly = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const checkIn = new Date(dateOnly);
    checkIn.setHours(7, 0, 0, 0);
    const checkOut = new Date(dateOnly);
    checkOut.setHours(8, 30, 0, 0);

    if (d < 5) {
      await prisma.attendanceLog.create({
        data: {
          userId: member1.id, locationId: main.id, attendanceDate: dateOnly,
          checkIn, checkOut, source: "biometric",
        },
      });
    }
    if (d < 3) {
      await prisma.attendanceLog.create({
        data: {
          userId: member2.id, locationId: main.id, attendanceDate: dateOnly,
          checkIn, checkOut, source: "manual",
        },
      });
    }
    if (d < 2) {
      await prisma.attendanceLog.create({
        data: {
          userId: member3.id, locationId: cc.id, attendanceDate: dateOnly,
          checkIn, checkOut, source: "biometric",
        },
      });
    }
  }

  // Biometric device
  const device = await prisma.biometricDevice.create({
    data: { name: "Front Door Scanner", locationId: main.id, deviceType: "fingerprint" },
  });

  // Device user mappings (member 1 and 2 mapped)
  await prisma.deviceUserMapping.createMany({
    data: [
      { deviceId: device.id, deviceUserId: "U001", userId: member1.id },
      { deviceId: device.id, deviceUserId: "U002", userId: member2.id },
    ],
  });

  // Unmatched biometric events
  await prisma.rawAttendanceEvent.createMany({
    data: [
      { deviceId: device.id, deviceUserId: "U099", eventTimestamp: daysAgo(1), eventType: "check_in", matchStatus: "unmatched" },
      { deviceId: device.id, deviceUserId: "U098", eventTimestamp: daysAgo(1), eventType: "check_in", matchStatus: "unmatched" },
      { deviceId: device.id, deviceUserId: "U097", eventTimestamp: daysAgo(2), eventType: "check_in", matchStatus: "unmatched" },
    ],
  });

  // Opening hours (Mon-Sat 6:00-22:00, Sun closed)
  for (const locId of [main.id, cc.id]) {
    for (let day = 0; day <= 6; day++) {
      await prisma.openingHour.create({
        data: {
          locationId: locId, dayOfWeek: day,
          openTime: day === 0 ? "00:00" : "06:00",
          closeTime: day === 0 ? "00:00" : "22:00",
          isClosed: day === 0,
        },
      });
    }
  }

  // Notification logs
  await prisma.notificationLog.createMany({
    data: [
      { userId: member2.id, templateName: "renewal_reminder_3d", channel: "whatsapp", recipient: "9222222222", status: "sent", deliveryDate: daysAgo(1), sentAt: daysAgo(1) },
      { userId: member3.id, templateName: "renewal_reminder_expired", channel: "sms", recipient: "9333333333", status: "pending", deliveryDate: todayDate() },
    ],
  });

  // Audit logs
  await prisma.auditLog.createMany({
    data: [
      { action: "Membership renewed", status: "success", details: JSON.stringify({ userId: member1.id, plan: "Monthly" }), actorId: admin.id, actorType: "admin" },
      { action: "Location created", status: "success", details: JSON.stringify({ name: "Main Branch" }), actorId: admin.id, actorType: "admin" },
      { action: "CSV imported", status: "success", details: JSON.stringify({ device: "Front Door Scanner", records: 10 }), actorId: staff.id, actorType: "admin" },
    ],
  });

  console.log("Seed completed successfully");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
