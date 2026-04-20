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

// Default POS catalog for a fresh gym instance. Idempotent — re-running the
// seed will not create duplicates because we look up by name first. We do not
// reset stock/price on re-seed so manual catalog tweaks survive.
//
// NOTE: Product.name is not @unique in the schema, so we cannot use upsert()
// against name. We use findFirst + create instead.
const DEFAULT_POS_PRODUCTS: Array<{
  name: string;
  price: number;
  stock: number;
  category: string;
}> = [
  // Supplements
  { name: "Whey Protein 1kg", price: 2499, stock: 10, category: "supplement" },
  { name: "Mass Gainer 1kg", price: 1899, stock: 10, category: "supplement" },
  { name: "Pre-workout 300g", price: 1799, stock: 10, category: "supplement" },
  // Snacks / quick energy
  { name: "Protein Bar", price: 120, stock: 50, category: "snack" },
  { name: "Energy Gel", price: 80, stock: 50, category: "snack" },
  { name: "Glucose Sachet", price: 20, stock: 100, category: "snack" },
  // Hydration / accessories
  { name: "Water Bottle 1L", price: 150, stock: 30, category: "accessory" },
  { name: "Shaker", price: 250, stock: 20, category: "accessory" },
  { name: "Hand Towel", price: 350, stock: 20, category: "accessory" },
  // Gym gear
  { name: "Wrist Wraps", price: 399, stock: 15, category: "gear" },
  { name: "Lifting Belt", price: 999, stock: 10, category: "gear" },
  { name: "Resistance Band", price: 599, stock: 15, category: "gear" },
];

export async function seedPosProducts(): Promise<{
  created: number;
  skipped: number;
}> {
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
  return { created, skipped };
}

async function main() {
  // Clear existing data
  await prisma.userDietPlan.deleteMany();
  await prisma.dietMeal.deleteMany();
  await prisma.dietPlan.deleteMany();
  await prisma.userWorkoutPlan.deleteMany();
  await prisma.workoutExercise.deleteMany();
  await prisma.workoutPlan.deleteMany();
  await prisma.facilityBooking.deleteMany();
  await prisma.facilitySlot.deleteMany();
  await prisma.facility.deleteMany();
  await prisma.inventoryLog.deleteMany();
  await prisma.sale.deleteMany();
  await prisma.product.deleteMany();
  await prisma.familyGroup.deleteMany();
  await prisma.payroll.deleteMany();
  await prisma.waiverSignature.deleteMany();
  await prisma.waiverTemplate.deleteMany();
  await prisma.giftCard.deleteMany();
  await prisma.enquiryFollowup.deleteMany();
  await prisma.paymentFollowup.deleteMany();
  await prisma.gymTarget.deleteMany();
  await prisma.aiMessage.deleteMany();
  await prisma.aiConversation.deleteMany();
  await prisma.aiUsage.deleteMany();
  await prisma.classBooking.deleteMany();
  await prisma.classSchedule.deleteMany();
  await prisma.gymClass.deleteMany();
  await prisma.equipment.deleteMany();
  await prisma.announcement.deleteMany();
  await prisma.expense.deleteMany();
  await prisma.referral.deleteMany();
  await prisma.promoCode.deleteMany();
  await prisma.enquiry.deleteMany();
  await prisma.gymSettings.deleteMany();
  await prisma.bodyMeasurement.deleteMany();
  await prisma.membershipFreeze.deleteMany();
  await prisma.leaveRequest.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.inAppNotification.deleteMany();
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
  // member1 birthday = today, member2 birthday = 3 days from now
  const todayBirthdate = new Date(1995, new Date().getMonth(), new Date().getDate());
  const upcomingBirthdate = new Date(1998, daysFromNow(3).getMonth(), daysFromNow(3).getDate());

  const member1 = await prisma.user.create({
    data: { email: "member1@test.com", password: hash, firstname: "Rahul", lastname: "Sharma", phone: "9111111111", locationId: main.id, birthdate: todayBirthdate },
  });
  const member2 = await prisma.user.create({
    data: { email: "member2@test.com", password: hash, firstname: "Priya", lastname: "Patel", phone: "9222222222", locationId: main.id, birthdate: upcomingBirthdate },
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

  // Leave requests
  await prisma.leaveRequest.createMany({
    data: [
      {
        workerId: admin.id,
        leaveType: "casual",
        startDate: daysFromNow(5),
        endDate: daysFromNow(6),
        reason: "Family function",
        status: "pending",
      },
      {
        workerId: staff.id,
        leaveType: "sick",
        startDate: daysAgo(10),
        endDate: daysAgo(9),
        reason: "Fever",
        status: "approved",
        reviewedBy: admin.id,
        reviewedAt: daysAgo(10),
      },
      {
        workerId: staff.id,
        leaveType: "personal",
        startDate: daysAgo(3),
        endDate: daysAgo(3),
        reason: "Personal work",
        status: "rejected",
        reviewedBy: admin.id,
        reviewedAt: daysAgo(3),
      },
    ],
  });

  // Worker attendance
  const todayDateOnly = todayDate();
  const yesterdayDateOnly = new Date(todayDateOnly);
  yesterdayDateOnly.setDate(yesterdayDateOnly.getDate() - 1);

  const adminCheckIn = new Date(todayDateOnly);
  adminCheckIn.setHours(8, 0, 0, 0);
  await prisma.attendanceLog.create({
    data: {
      workerId: admin.id,
      locationId: main.id,
      attendanceDate: todayDateOnly,
      checkIn: adminCheckIn,
      source: "manual",
    },
  });

  const staffCheckIn = new Date(yesterdayDateOnly);
  staffCheckIn.setHours(9, 0, 0, 0);
  const staffCheckOut = new Date(yesterdayDateOnly);
  staffCheckOut.setHours(18, 0, 0, 0);
  await prisma.attendanceLog.create({
    data: {
      workerId: staff.id,
      locationId: main.id,
      attendanceDate: yesterdayDateOnly,
      checkIn: staffCheckIn,
      checkOut: staffCheckOut,
      source: "manual",
    },
  });

  // Audit logs
  await prisma.auditLog.createMany({
    data: [
      { action: "Membership renewed", status: "success", details: JSON.stringify({ userId: member1.id, plan: "Monthly" }), actorId: admin.id, actorType: "admin" },
      { action: "Location created", status: "success", details: JSON.stringify({ name: "Main Branch" }), actorId: admin.id, actorType: "admin" },
      { action: "CSV imported", status: "success", details: JSON.stringify({ device: "Front Door Scanner", records: 10 }), actorId: staff.id, actorType: "admin" },
    ],
  });

  // Body measurements for member1 (last 3 months)
  await prisma.bodyMeasurement.createMany({
    data: [
      {
        userId: member1.id,
        date: daysAgo(90),
        weight: 78.5,
        height: 175,
        bmi: 25.63,
        chest: 96,
        waist: 84,
        hips: 98,
        biceps: 32,
        notes: "Initial measurement",
      },
      {
        userId: member1.id,
        date: daysAgo(60),
        weight: 76.2,
        height: 175,
        bmi: 24.88,
        chest: 95,
        waist: 82,
        hips: 97,
        biceps: 33,
        notes: "Good progress",
      },
      {
        userId: member1.id,
        date: daysAgo(30),
        weight: 74.0,
        height: 175,
        bmi: 24.16,
        chest: 94,
        waist: 80,
        hips: 96,
        biceps: 34,
        notes: "Excellent progress",
      },
    ],
  });

  // Membership freeze for member3 (expired member, was frozen 10 days)
  await prisma.membershipFreeze.create({
    data: {
      userId: member3.id,
      memberTicketId: ticket3.id,
      freezeStart: daysAgo(25),
      freezeEnd: daysAgo(15),
      reason: "Travel",
      status: "completed",
      daysAdded: 10,
    },
  });

  // Gym Settings
  await prisma.gymSettings.createMany({
    data: [
      { key: "grace_period_days", value: "7" },
      { key: "auto_checkout_enabled", value: "true" },
    ],
  });

  // Enquiries
  await prisma.enquiry.createMany({
    data: [
      {
        name: "Ravi Verma",
        phone: "9666666666",
        email: "ravi@example.com",
        source: "walk_in",
        interest: "Monthly plan",
        locationId: main.id,
        status: "new",
      },
      {
        name: "Deepa Nair",
        phone: "9777777777",
        source: "referral",
        interest: "Personal Training",
        locationId: main.id,
        status: "follow_up",
        followUpDate: daysFromNow(2),
        notes: "Referred by Rahul Sharma. Interested in PT sessions.",
      },
      {
        name: "Karan Mehta",
        phone: "9888888888",
        email: "karan@example.com",
        source: "social_media",
        interest: "Quarterly plan",
        locationId: cc.id,
        status: "converted",
        convertedUserId: member5.id,
      },
    ],
  });

  // Promo codes
  await prisma.promoCode.createMany({
    data: [
      {
        code: "WELCOME20",
        discountType: "percentage",
        discountValue: 20,
        maxUses: 100,
        usedCount: 3,
        validFrom: daysAgo(30),
        validTo: daysFromNow(60),
        isActive: true,
      },
      {
        code: "SUMMER10",
        discountType: "flat",
        discountValue: 500,
        maxUses: 50,
        usedCount: 12,
        validFrom: daysAgo(90),
        validTo: daysAgo(30),
        isActive: false,
      },
    ],
  });

  // Referrals (member1 referred 2 people)
  await prisma.referral.createMany({
    data: [
      {
        referrerId: member1.id,
        referredId: member5.id,
        referredName: "Vikram Singh",
        referredPhone: "9555555555",
        status: "converted",
        rewardGiven: true,
      },
      {
        referrerId: member1.id,
        referredName: "Deepa Nair",
        referredPhone: "9777777777",
        status: "pending",
        rewardGiven: false,
      },
    ],
  });

  // Expenses (5 across last 2 months)
  await prisma.expense.createMany({
    data: [
      {
        category: "rent",
        description: "Monthly rent - Main Branch",
        amount: 50000,
        expenseDate: daysAgo(5),
        locationId: main.id,
        paidBy: "bank_transfer",
      },
      {
        category: "salary",
        description: "Staff salaries - April",
        amount: 35000,
        expenseDate: daysAgo(3),
        locationId: main.id,
        paidBy: "bank_transfer",
      },
      {
        category: "equipment",
        description: "New treadmill belt replacement",
        amount: 8500,
        expenseDate: daysAgo(15),
        locationId: main.id,
        paidBy: "upi",
      },
      {
        category: "maintenance",
        description: "AC servicing - City Center",
        amount: 3500,
        expenseDate: daysAgo(40),
        locationId: cc.id,
        paidBy: "cash",
      },
      {
        category: "utilities",
        description: "Electricity bill - March",
        amount: 12000,
        expenseDate: daysAgo(35),
        locationId: main.id,
        paidBy: "bank_transfer",
      },
    ],
  });

  // Announcements (3: 1 active general, 1 active member-only, 1 expired)
  await prisma.announcement.createMany({
    data: [
      {
        title: "Gym Timings Changed",
        content: "Starting next week, the gym will open at 5:30 AM instead of 6:00 AM. Evening closing remains at 10 PM.",
        priority: "high",
        targetGroup: "all",
        isActive: true,
        expiresAt: daysFromNow(14),
      },
      {
        title: "New Yoga Batch Starting",
        content: "We are starting a new morning yoga batch from Monday. Interested members can register at the front desk.",
        priority: "normal",
        targetGroup: "members",
        locationId: main.id,
        isActive: true,
        expiresAt: daysFromNow(7),
      },
      {
        title: "Diwali Offer - 30% Off",
        content: "Get 30% off on all annual plans. Offer valid till November 15.",
        priority: "urgent",
        targetGroup: "all",
        isActive: false,
        expiresAt: daysAgo(30),
      },
    ],
  });

  // Equipment (5 items across both locations)
  await prisma.equipment.createMany({
    data: [
      {
        name: "Treadmill - LifeFitness T5",
        category: "cardio",
        locationId: main.id,
        purchaseDate: daysAgo(365),
        purchasePrice: 150000,
        condition: "good",
        lastServiceDate: daysAgo(30),
        nextServiceDate: daysFromNow(60),
      },
      {
        name: "Bench Press Station",
        category: "strength",
        locationId: main.id,
        purchaseDate: daysAgo(200),
        purchasePrice: 45000,
        condition: "fair",
        lastServiceDate: daysAgo(90),
        nextServiceDate: daysAgo(10),
        notes: "Padding needs replacement",
      },
      {
        name: "Dumbbells Set (5-30 kg)",
        category: "free_weights",
        locationId: main.id,
        purchaseDate: daysAgo(300),
        purchasePrice: 35000,
        condition: "good",
      },
      {
        name: "Elliptical Trainer",
        category: "cardio",
        locationId: cc.id,
        purchaseDate: daysAgo(180),
        purchasePrice: 85000,
        condition: "needs_repair",
        lastServiceDate: daysAgo(60),
        nextServiceDate: daysAgo(5),
        notes: "Display not working",
      },
      {
        name: "Resistance Bands Set",
        category: "accessories",
        locationId: cc.id,
        purchaseDate: daysAgo(30),
        purchasePrice: 2500,
        condition: "good",
      },
    ],
  });

  // Classes
  const yogaClass = await prisma.gymClass.create({
    data: {
      name: "Morning Yoga",
      classType: "group",
      locationId: main.id,
      maxCapacity: 15,
      schedules: {
        create: [
          { dayOfWeek: 1, startTime: "07:00", endTime: "08:00" },
          { dayOfWeek: 3, startTime: "07:00", endTime: "08:00" },
          { dayOfWeek: 5, startTime: "07:00", endTime: "08:00" },
        ],
      },
    },
  });

  const zumbaClass = await prisma.gymClass.create({
    data: {
      name: "Evening Zumba",
      classType: "group",
      locationId: main.id,
      maxCapacity: 20,
      schedules: {
        create: [
          { dayOfWeek: 2, startTime: "18:00", endTime: "19:00" },
          { dayOfWeek: 4, startTime: "18:00", endTime: "19:00" },
        ],
      },
    },
  });

  // Suppress unused variable warnings
  void yogaClass;
  void zumbaClass;

  // ─── New model seed data ───
  try {
    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const currentYear = now.getFullYear();

    // GymTarget — 1 target for current month
    await prisma.gymTarget.create({
      data: {
        month: currentMonth,
        year: currentYear,
        targetRevenue: 500000,
        targetNewMembers: 25,
        targetRenewals: 40,
        locationId: main.id,
      },
    });

    // PaymentFollowup — 2 sample followups
    await prisma.paymentFollowup.createMany({
      data: [
        {
          userId: member3.id,
          memberTicketId: ticket3.id,
          amountDue: 1500,
          dueDate: daysAgo(5),
          assignedToId: staff.id,
          status: "pending",
          priority: "high",
          notes: "Membership expired, needs renewal reminder",
          nextFollowupAt: daysFromNow(1),
        },
        {
          userId: member5.id,
          amountDue: 1500,
          dueDate: daysFromNow(5),
          assignedToId: admin.id,
          status: "contacted",
          priority: "normal",
          notes: "Interested in monthly plan, asked to call back",
          lastContactedAt: daysAgo(1),
          nextFollowupAt: daysFromNow(3),
        },
      ],
    });

    // Fetch enquiry for followup (use the "follow_up" one)
    const enquiries = await prisma.enquiry.findMany({ take: 3 });
    const followUpEnquiry = enquiries.find((e) => e.status === "follow_up") || enquiries[0];

    // EnquiryFollowup — 2 sample followups
    if (followUpEnquiry) {
      await prisma.enquiryFollowup.createMany({
        data: [
          {
            enquiryId: followUpEnquiry.id,
            workerId: staff.id,
            action: "call",
            outcome: "interested",
            notes: "Spoke on phone, wants to visit this weekend",
            nextFollowupAt: daysFromNow(2),
          },
          {
            enquiryId: followUpEnquiry.id,
            workerId: staff.id,
            action: "whatsapp",
            outcome: "callback",
            notes: "Sent plan details on WhatsApp, will follow up",
            nextFollowupAt: daysFromNow(5),
          },
        ],
      });
    }

    // GiftCard — 2 gift cards (1 active, 1 redeemed)
    await prisma.giftCard.createMany({
      data: [
        {
          code: "GIFT-2026-001",
          amount: 3000,
          balance: 3000,
          purchaserId: member1.id,
          recipientName: "Anita Sharma",
          recipientPhone: "9600000001",
          status: "active",
          expiresAt: daysFromNow(90),
        },
        {
          code: "GIFT-2026-002",
          amount: 2000,
          balance: 0,
          purchaserId: member4.id,
          recipientName: "Ravi Kumar",
          recipientPhone: "9600000002",
          status: "redeemed",
          expiresAt: daysFromNow(30),
        },
      ],
    });

    // WaiverTemplate — 1 health waiver template
    const waiver = await prisma.waiverTemplate.create({
      data: {
        name: "Health & Liability Waiver",
        content:
          "I hereby declare that I am physically fit to participate in exercise activities. I understand the risks involved and release the gym from any liability for injuries sustained during workouts. I confirm that I have disclosed any pre-existing medical conditions to the gym staff.",
        isActive: true,
        required: true,
      },
    });

    // WaiverSignature — 1 signed waiver
    await prisma.waiverSignature.create({
      data: {
        userId: member1.id,
        templateId: waiver.id,
        ipAddress: "192.168.1.10",
        signature: "Rahul Sharma",
      },
    });

    // Payroll — 1 payroll entry for a worker
    await prisma.payroll.create({
      data: {
        workerId: staff.id,
        month: currentMonth,
        year: currentYear,
        baseSalary: 25000,
        commission: 3000,
        deductions: 1500,
        bonus: 0,
        netPayable: 26500,
        status: "pending",
      },
    });

    // FamilyGroup — 1 family group with primary member
    const familyGroup = await prisma.familyGroup.create({
      data: {
        name: "Sharma Family",
        primaryMemberId: member1.id,
      },
    });
    await prisma.user.update({
      where: { id: member1.id },
      data: { familyGroupId: familyGroup.id },
    });
    await prisma.user.update({
      where: { id: member2.id },
      data: { familyGroupId: familyGroup.id },
    });

    // Product — 4 products
    const proteinShake = await prisma.product.create({
      data: { name: "Protein Shake", price: 150, stock: 50, category: "beverage" },
    });
    const tshirt = await prisma.product.create({
      data: { name: "Gym T-Shirt", price: 800, stock: 20, category: "apparel" },
    });
    const towel = await prisma.product.create({
      data: { name: "Gym Towel", price: 300, stock: 30, category: "accessories" },
    });
    const waterBottle = await prisma.product.create({
      data: { name: "Water Bottle (1L)", price: 250, stock: 40, category: "accessories" },
    });
    void tshirt;
    void waterBottle;

    // Sale — 2 sample sales
    await prisma.sale.createMany({
      data: [
        {
          productId: proteinShake.id,
          quantity: 2,
          unitPrice: 150,
          totalAmount: 300,
          userId: member1.id,
          paymentMode: "cash",
          locationId: main.id,
          soldById: staff.id,
        },
        {
          productId: towel.id,
          quantity: 1,
          unitPrice: 300,
          totalAmount: 300,
          userId: member2.id,
          paymentMode: "upi",
          locationId: main.id,
          soldById: staff.id,
        },
      ],
    });

    // InventoryLog — 2 stock changes
    await prisma.inventoryLog.createMany({
      data: [
        {
          productId: proteinShake.id,
          change: 50,
          reason: "restock",
        },
        {
          productId: proteinShake.id,
          change: -2,
          reason: "sale",
        },
      ],
    });

    // Facility — 2 facilities
    const yogaStudio = await prisma.facility.create({
      data: { name: "Yoga Studio", type: "studio", locationId: main.id },
    });
    const swimmingPool = await prisma.facility.create({
      data: { name: "Swimming Pool", type: "pool", locationId: main.id },
    });

    // FacilitySlot — 3 slots for today/tomorrow
    const slot1 = await prisma.facilitySlot.create({
      data: {
        facilityId: yogaStudio.id,
        date: todayDate(),
        startTime: "07:00",
        endTime: "08:00",
        maxCapacity: 10,
        status: "available",
      },
    });
    await prisma.facilitySlot.create({
      data: {
        facilityId: yogaStudio.id,
        date: daysFromNow(1),
        startTime: "07:00",
        endTime: "08:00",
        maxCapacity: 10,
        status: "available",
      },
    });
    await prisma.facilitySlot.create({
      data: {
        facilityId: swimmingPool.id,
        date: todayDate(),
        startTime: "09:00",
        endTime: "10:00",
        maxCapacity: 15,
        status: "available",
      },
    });

    // FacilityBooking — 1 sample booking
    await prisma.facilityBooking.create({
      data: {
        slotId: slot1.id,
        userId: member1.id,
        status: "booked",
      },
    });

    // WorkoutPlan — 1 plan with exercises
    const workoutPlan = await prisma.workoutPlan.create({
      data: {
        name: "Beginner Full Body",
        description: "4-week beginner-friendly full body workout plan",
        createdById: admin.id,
        isActive: true,
      },
    });

    // WorkoutExercise — 4 exercises
    await prisma.workoutExercise.createMany({
      data: [
        { planId: workoutPlan.id, name: "Barbell Squat", sets: 3, reps: 10, weight: 40, day: "monday", order: 1 },
        { planId: workoutPlan.id, name: "Bench Press", sets: 3, reps: 10, weight: 30, day: "monday", order: 2 },
        { planId: workoutPlan.id, name: "Deadlift", sets: 3, reps: 8, weight: 50, day: "wednesday", order: 1 },
        { planId: workoutPlan.id, name: "Overhead Press", sets: 3, reps: 10, weight: 20, day: "wednesday", order: 2, notes: "Use dumbbells if barbell too heavy" },
      ],
    });

    // UserWorkoutPlan — 1 assignment
    await prisma.userWorkoutPlan.create({
      data: {
        userId: member1.id,
        planId: workoutPlan.id,
        startDate: daysAgo(7),
        isActive: true,
      },
    });

    // DietPlan — 1 diet plan
    const dietPlan = await prisma.dietPlan.create({
      data: {
        name: "Muscle Gain Diet",
        description: "High protein diet plan for muscle building",
        createdById: admin.id,
        isActive: true,
      },
    });

    // DietMeal — 3 meals
    await prisma.dietMeal.createMany({
      data: [
        { planId: dietPlan.id, mealType: "breakfast", description: "4 egg whites, 2 whole eggs, oatmeal with banana, black coffee", calories: 500, protein: 35, carbs: 50, fat: 12, order: 1 },
        { planId: dietPlan.id, mealType: "lunch", description: "200g chicken breast, brown rice, mixed vegetable salad, dal", calories: 700, protein: 50, carbs: 60, fat: 15, order: 2 },
        { planId: dietPlan.id, mealType: "dinner", description: "200g paneer or fish, 2 roti, green vegetables, curd", calories: 600, protein: 40, carbs: 45, fat: 18, order: 3 },
      ],
    });

    // UserDietPlan — 1 assignment
    await prisma.userDietPlan.create({
      data: {
        userId: member1.id,
        planId: dietPlan.id,
        startDate: daysAgo(7),
        isActive: true,
      },
    });

    console.log("New model seed data created successfully");
  } catch (err) {
    console.error("Warning: Failed to seed new models (non-blocking):", err);
  }

  // ── Default POS catalog (idempotent, makes /admin/pos usable on a fresh DB) ──
  try {
    await seedPosProducts();
  } catch (err) {
    console.error("Warning: Failed to seed POS products (non-blocking):", err);
  }

  // ── In-App Notifications ──
  try {
    await prisma.inAppNotification.createMany({
      data: [
        {
          workerId: admin.id,
          type: "new_enquiry",
          title: "New enquiry from Ravi Verma",
          message: "9876543210",
          link: "/admin/enquiries",
          createdAt: daysAgo(1),
        },
        {
          workerId: admin.id,
          type: "leave_request",
          title: "Leave request from Staff User",
          message: "casual leave: 2026-04-15 to 2026-04-16",
          link: "/admin/leaves",
          readAt: daysAgo(0),
          createdAt: daysAgo(2),
        },
        {
          workerId: admin.id,
          type: "new_member",
          title: "New member: Priya Sharma",
          message: "Joined with 3 Month Plan",
          link: "/admin/members",
          createdAt: daysAgo(3),
        },
        {
          userId: member1.id,
          type: "payment_received",
          title: "Payment of ₹3,000 received",
          message: "3 Month Plan — valid until 15/07/2026",
          link: "/member/invoices",
          createdAt: daysAgo(1),
        },
        {
          userId: member1.id,
          type: "new_announcement",
          title: "Gym closed on Holi",
          message: "The gym will be closed on March 14th for Holi.",
          link: "/member/announcements",
          readAt: daysAgo(0),
          createdAt: daysAgo(5),
        },
      ],
    });
    console.log("In-app notifications seeded");
  } catch (err) {
    console.error("Warning: Failed to seed in-app notifications:", err);
  }

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
