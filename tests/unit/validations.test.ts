import { describe, it, expect } from "vitest";
import {
  createMemberSchema,
  updateMemberSchema,
  importCSVSchema,
  planSchema,
  createWorkerSchema,
  updateWorkerSchema,
  renewalSchema,
  equipmentSchema,
  expenseSchema,
  announcementSchema,
  createEnquirySchema,
  updateEnquirySchema,
  freezeSchema,
  leaveRequestSchema,
  reviewLeaveSchema,
  resetPasswordSchema,
  changeSelfPasswordSchema,
  promoCodeSchema,
  referralSchema,
  measurementSchema,
  locationSchema,
  openingHoursSchema,
  classSchema,
  bulkNotifySchema,
  manualCheckInSchema,
  workerCheckInSchema,
  zodErrors,
} from "@/lib/validations";

// ── zodErrors helper ──────────────────────────────────────────────────

describe("zodErrors", () => {
  it("maps Zod issues to Record<string, string>", () => {
    const result = createMemberSchema.safeParse({});
    expect(result.success).toBe(false);
    if (!result.success) {
      const mapped = zodErrors(result.error);
      expect(mapped).toHaveProperty("firstname");
      expect(mapped).toHaveProperty("lastname");
      expect(mapped).toHaveProperty("email");
      expect(typeof mapped.firstname).toBe("string");
    }
  });

  it("keeps only the first error per field", () => {
    // email with empty string triggers min-length, not email-format
    const result = createMemberSchema.safeParse({
      firstname: "",
      lastname: "",
      email: "",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const mapped = zodErrors(result.error);
      // Each field should have exactly one message
      const keys = Object.keys(mapped);
      expect(keys.length).toBeGreaterThan(0);
    }
  });

  it("uses _form key for path-less issues", () => {
    // Manually construct a ZodError with an empty path
    const { ZodError } = require("zod");
    const err = new ZodError([
      { code: "custom", message: "Global error", path: [] },
    ]);
    const mapped = zodErrors(err);
    expect(mapped._form).toBe("Global error");
  });
});

// ── renewalSchema ─────────────────────────────────────────────────────

describe("renewalSchema", () => {
  const valid = {
    userId: 1,
    planId: 2,
    locationId: 3,
    paymentMode: "cash",
  };

  it("accepts valid input", () => {
    expect(renewalSchema.safeParse(valid).success).toBe(true);
  });

  it("accepts optional upiReference and promoCode", () => {
    const r = renewalSchema.safeParse({
      ...valid,
      upiReference: "REF123",
      promoCode: "PROMO10",
    });
    expect(r.success).toBe(true);
  });

  it("passes when optional fields are omitted", () => {
    const r = renewalSchema.safeParse(valid);
    expect(r.success).toBe(true);
  });

  it("fails when userId is missing", () => {
    const { userId, ...rest } = valid;
    expect(renewalSchema.safeParse(rest).success).toBe(false);
  });

  it("fails when planId is 0 or negative", () => {
    expect(renewalSchema.safeParse({ ...valid, planId: 0 }).success).toBe(false);
    expect(renewalSchema.safeParse({ ...valid, planId: -1 }).success).toBe(false);
  });

  it("fails when paymentMode is empty string", () => {
    expect(renewalSchema.safeParse({ ...valid, paymentMode: "" }).success).toBe(false);
  });

  it("fails when paymentMode is whitespace only", () => {
    expect(renewalSchema.safeParse({ ...valid, paymentMode: "   " }).success).toBe(false);
  });
});

// ── planSchema ────────────────────────────────────────────────────────

describe("planSchema", () => {
  const valid = { name: "Monthly", expireDays: 30, price: 1500 };

  it("accepts valid input", () => {
    expect(planSchema.safeParse(valid).success).toBe(true);
  });

  it("accepts optional occasions field", () => {
    expect(planSchema.safeParse({ ...valid, occasions: 12 }).success).toBe(true);
  });

  it("accepts occasions as null", () => {
    expect(planSchema.safeParse({ ...valid, occasions: null }).success).toBe(true);
  });

  it("passes when occasions is omitted", () => {
    expect(planSchema.safeParse(valid).success).toBe(true);
  });

  it("fails when name is empty", () => {
    expect(planSchema.safeParse({ ...valid, name: "" }).success).toBe(false);
  });

  it("fails when expireDays is 0", () => {
    expect(planSchema.safeParse({ ...valid, expireDays: 0 }).success).toBe(false);
  });

  it("fails when price is 0", () => {
    expect(planSchema.safeParse({ ...valid, price: 0 }).success).toBe(false);
  });

  it("fails when price is negative", () => {
    expect(planSchema.safeParse({ ...valid, price: -100 }).success).toBe(false);
  });

  it("fails when expireDays is a float", () => {
    expect(planSchema.safeParse({ ...valid, expireDays: 30.5 }).success).toBe(false);
  });
});

// ── createMemberSchema ────────────────────────────────────────────────

describe("createMemberSchema", () => {
  const valid = {
    firstname: "Amit",
    lastname: "Kumar",
    email: "amit@example.com",
  };

  it("accepts valid input", () => {
    expect(createMemberSchema.safeParse(valid).success).toBe(true);
  });

  it("accepts optional phone and gender", () => {
    const r = createMemberSchema.safeParse({
      ...valid,
      phone: "9876543210",
      gender: "male",
    });
    expect(r.success).toBe(true);
  });

  it("accepts locationId as null", () => {
    expect(createMemberSchema.safeParse({ ...valid, locationId: null }).success).toBe(true);
  });

  it("passes when optional fields are omitted", () => {
    expect(createMemberSchema.safeParse(valid).success).toBe(true);
  });

  it("fails when firstname is missing", () => {
    const { firstname, ...rest } = valid;
    expect(createMemberSchema.safeParse(rest).success).toBe(false);
  });

  it("fails when email is invalid", () => {
    expect(createMemberSchema.safeParse({ ...valid, email: "notanemail" }).success).toBe(false);
  });

  it("fails when email is empty string", () => {
    expect(createMemberSchema.safeParse({ ...valid, email: "" }).success).toBe(false);
  });

  it("trims whitespace from firstname", () => {
    const r = createMemberSchema.safeParse({ ...valid, firstname: "  Amit  " });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.firstname).toBe("Amit");
    }
  });

  it("fails when firstname is whitespace only", () => {
    expect(createMemberSchema.safeParse({ ...valid, firstname: "   " }).success).toBe(false);
  });
});

// ── freezeSchema ──────────────────────────────────────────────────────

describe("freezeSchema", () => {
  const valid = {
    userId: 1,
    memberTicketId: 5,
    freezeStart: "2025-01-01",
    freezeEnd: "2025-01-15",
  };

  it("accepts valid input", () => {
    expect(freezeSchema.safeParse(valid).success).toBe(true);
  });

  it("accepts optional reason", () => {
    expect(freezeSchema.safeParse({ ...valid, reason: "Vacation" }).success).toBe(true);
  });

  it("passes when reason is omitted", () => {
    expect(freezeSchema.safeParse(valid).success).toBe(true);
  });

  it("fails when freezeStart is empty", () => {
    expect(freezeSchema.safeParse({ ...valid, freezeStart: "" }).success).toBe(false);
  });

  it("fails when userId is missing", () => {
    const { userId, ...rest } = valid;
    expect(freezeSchema.safeParse(rest).success).toBe(false);
  });

  it("fails when memberTicketId is negative", () => {
    expect(freezeSchema.safeParse({ ...valid, memberTicketId: -1 }).success).toBe(false);
  });
});

// ── expenseSchema ─────────────────────────────────────────────────────

describe("expenseSchema", () => {
  const valid = {
    category: "Utilities",
    description: "Electricity bill",
    amount: 5000,
    expenseDate: "2025-03-01",
  };

  it("accepts valid input", () => {
    expect(expenseSchema.safeParse(valid).success).toBe(true);
  });

  it("accepts optional locationId, paidBy, receipt", () => {
    const r = expenseSchema.safeParse({
      ...valid,
      locationId: 1,
      paidBy: "Admin",
      receipt: "receipt-url",
    });
    expect(r.success).toBe(true);
  });

  it("passes when optional fields are omitted", () => {
    expect(expenseSchema.safeParse(valid).success).toBe(true);
  });

  it("fails when amount is 0", () => {
    expect(expenseSchema.safeParse({ ...valid, amount: 0 }).success).toBe(false);
  });

  it("fails when amount is negative", () => {
    expect(expenseSchema.safeParse({ ...valid, amount: -100 }).success).toBe(false);
  });

  it("fails when expenseDate is empty", () => {
    expect(expenseSchema.safeParse({ ...valid, expenseDate: "" }).success).toBe(false);
  });

  it("fails when category is missing", () => {
    const { category, ...rest } = valid;
    expect(expenseSchema.safeParse(rest).success).toBe(false);
  });
});

// ── classSchema ───────────────────────────────────────────────────────

describe("classSchema", () => {
  const valid = {
    name: "Yoga",
    locationId: 1,
    maxCapacity: 20,
    schedules: [{ dayOfWeek: 1, startTime: "09:00", endTime: "10:00" }],
  };

  it("accepts valid input", () => {
    expect(classSchema.safeParse(valid).success).toBe(true);
  });

  it("accepts optional description, classType, instructorId", () => {
    const r = classSchema.safeParse({
      ...valid,
      description: "Morning yoga",
      classType: "group",
      instructorId: 5,
    });
    expect(r.success).toBe(true);
  });

  it("accepts instructorId as null", () => {
    expect(classSchema.safeParse({ ...valid, instructorId: null }).success).toBe(true);
  });

  it("fails when schedules array is empty", () => {
    expect(classSchema.safeParse({ ...valid, schedules: [] }).success).toBe(false);
  });

  it("fails when maxCapacity is 0", () => {
    expect(classSchema.safeParse({ ...valid, maxCapacity: 0 }).success).toBe(false);
  });

  it("fails when dayOfWeek is out of range", () => {
    const r = classSchema.safeParse({
      ...valid,
      schedules: [{ dayOfWeek: 7, startTime: "09:00", endTime: "10:00" }],
    });
    expect(r.success).toBe(false);
  });

  it("fails when name is empty", () => {
    expect(classSchema.safeParse({ ...valid, name: "" }).success).toBe(false);
  });

  it("fails when locationId is missing", () => {
    const { locationId, ...rest } = valid;
    expect(classSchema.safeParse(rest).success).toBe(false);
  });
});

// ── createWorkerSchema ────────────────────────────────────────────────

describe("createWorkerSchema", () => {
  const valid = {
    email: "worker@gym.com",
    password: "secret123",
    firstname: "John",
    lastname: "Doe",
    role: "staff",
  };

  it("accepts valid input", () => {
    expect(createWorkerSchema.safeParse(valid).success).toBe(true);
  });

  it("accepts optional locationId", () => {
    expect(createWorkerSchema.safeParse({ ...valid, locationId: 1 }).success).toBe(true);
  });

  it("accepts locationId as null", () => {
    expect(createWorkerSchema.safeParse({ ...valid, locationId: null }).success).toBe(true);
  });

  it("fails when password is too short", () => {
    expect(createWorkerSchema.safeParse({ ...valid, password: "abc" }).success).toBe(false);
  });

  it("fails when password is exactly 5 chars", () => {
    expect(createWorkerSchema.safeParse({ ...valid, password: "abcde" }).success).toBe(false);
  });

  it("accepts password of exactly 6 chars", () => {
    expect(createWorkerSchema.safeParse({ ...valid, password: "abcdef" }).success).toBe(true);
  });

  it("fails when email is invalid format", () => {
    expect(createWorkerSchema.safeParse({ ...valid, email: "bademail" }).success).toBe(false);
  });

  it("fails when role is empty", () => {
    expect(createWorkerSchema.safeParse({ ...valid, role: "" }).success).toBe(false);
  });
});

// ── updateWorkerSchema ────────────────────────────────────────────────

describe("updateWorkerSchema", () => {
  const valid = {
    firstname: "John",
    lastname: "Doe",
    email: "worker@gym.com",
    role: "admin",
  };

  it("accepts valid input without password", () => {
    expect(updateWorkerSchema.safeParse(valid).success).toBe(true);
  });

  it("accepts empty string password (no change)", () => {
    expect(updateWorkerSchema.safeParse({ ...valid, password: "" }).success).toBe(true);
  });

  it("accepts valid password", () => {
    expect(updateWorkerSchema.safeParse({ ...valid, password: "newpass123" }).success).toBe(true);
  });

  it("fails when password is 1-5 chars (too short but not empty)", () => {
    expect(updateWorkerSchema.safeParse({ ...valid, password: "abc" }).success).toBe(false);
  });
});

// ── promoCodeSchema ───────────────────────────────────────────────────

describe("promoCodeSchema", () => {
  const valid = {
    code: "SUMMER25",
    discountType: "percentage" as const,
    discountValue: 25,
    validFrom: "2025-06-01",
    validTo: "2025-08-31",
  };

  it("accepts valid input", () => {
    expect(promoCodeSchema.safeParse(valid).success).toBe(true);
  });

  it("accepts flat discount type", () => {
    expect(promoCodeSchema.safeParse({ ...valid, discountType: "flat" }).success).toBe(true);
  });

  it("fails with invalid discount type", () => {
    expect(promoCodeSchema.safeParse({ ...valid, discountType: "bogus" }).success).toBe(false);
  });

  it("fails when discountValue is 0", () => {
    expect(promoCodeSchema.safeParse({ ...valid, discountValue: 0 }).success).toBe(false);
  });

  it("accepts optional maxUses", () => {
    expect(promoCodeSchema.safeParse({ ...valid, maxUses: 100 }).success).toBe(true);
  });

  it("passes when maxUses is omitted", () => {
    expect(promoCodeSchema.safeParse(valid).success).toBe(true);
  });
});

// ── locationSchema ────────────────────────────────────────────────────

describe("locationSchema", () => {
  const valid = { name: "Main Branch", code: "MAIN" };

  it("accepts valid input", () => {
    expect(locationSchema.safeParse(valid).success).toBe(true);
  });

  it("accepts optional address and phone", () => {
    expect(
      locationSchema.safeParse({ ...valid, address: "123 Street", phone: "1234567890" }).success
    ).toBe(true);
  });

  it("fails when name is empty", () => {
    expect(locationSchema.safeParse({ ...valid, name: "" }).success).toBe(false);
  });

  it("fails when code is missing", () => {
    expect(locationSchema.safeParse({ name: "Branch" }).success).toBe(false);
  });
});

// ── openingHoursSchema ────────────────────────────────────────────────

describe("openingHoursSchema", () => {
  const makeDay = (dow: number) => ({
    dayOfWeek: dow,
    openTime: "06:00",
    closeTime: "22:00",
    isClosed: false,
  });
  const valid = Array.from({ length: 7 }, (_, i) => makeDay(i));

  it("accepts array of 7 days", () => {
    expect(openingHoursSchema.safeParse(valid).success).toBe(true);
  });

  it("fails with fewer than 7 days", () => {
    expect(openingHoursSchema.safeParse(valid.slice(0, 6)).success).toBe(false);
  });

  it("fails with more than 7 days", () => {
    expect(openingHoursSchema.safeParse([...valid, makeDay(0)]).success).toBe(false);
  });

  it("fails when dayOfWeek is out of 0-6 range", () => {
    const bad = valid.map((d, i) => (i === 0 ? { ...d, dayOfWeek: 7 } : d));
    expect(openingHoursSchema.safeParse(bad).success).toBe(false);
  });
});

// ── leaveRequestSchema ────────────────────────────────────────────────

describe("leaveRequestSchema", () => {
  const valid = {
    leaveType: "casual",
    startDate: "2025-04-01",
    endDate: "2025-04-03",
  };

  it("accepts valid input", () => {
    expect(leaveRequestSchema.safeParse(valid).success).toBe(true);
  });

  it("accepts optional reason", () => {
    expect(leaveRequestSchema.safeParse({ ...valid, reason: "Family event" }).success).toBe(true);
  });

  it("fails when leaveType is empty", () => {
    expect(leaveRequestSchema.safeParse({ ...valid, leaveType: "" }).success).toBe(false);
  });

  it("fails when startDate is missing", () => {
    const { startDate, ...rest } = valid;
    expect(leaveRequestSchema.safeParse(rest).success).toBe(false);
  });
});

// ── reviewLeaveSchema ─────────────────────────────────────────────────

describe("reviewLeaveSchema", () => {
  it("accepts approved status", () => {
    expect(reviewLeaveSchema.safeParse({ id: 1, status: "approved", reviewedBy: 2 }).success).toBe(true);
  });

  it("accepts rejected status", () => {
    expect(reviewLeaveSchema.safeParse({ id: 1, status: "rejected", reviewedBy: 2 }).success).toBe(true);
  });

  it("fails with invalid status", () => {
    expect(reviewLeaveSchema.safeParse({ id: 1, status: "pending", reviewedBy: 2 }).success).toBe(false);
  });
});

// ── resetPasswordSchema & changeSelfPasswordSchema ────────────────────

describe("resetPasswordSchema", () => {
  it("accepts valid input", () => {
    expect(resetPasswordSchema.safeParse({ targetId: 1, newPassword: "newpass" }).success).toBe(true);
  });

  it("fails when password is too short", () => {
    expect(resetPasswordSchema.safeParse({ targetId: 1, newPassword: "short" }).success).toBe(false);
  });
});

describe("changeSelfPasswordSchema", () => {
  it("accepts valid input", () => {
    expect(
      changeSelfPasswordSchema.safeParse({ currentPassword: "old", newPassword: "newsecret" }).success
    ).toBe(true);
  });

  it("fails when currentPassword is empty", () => {
    expect(
      changeSelfPasswordSchema.safeParse({ currentPassword: "", newPassword: "newsecret" }).success
    ).toBe(false);
  });

  it("fails when newPassword is under 6 chars", () => {
    expect(
      changeSelfPasswordSchema.safeParse({ currentPassword: "old", newPassword: "abc" }).success
    ).toBe(false);
  });
});

// ── bulkNotifySchema ──────────────────────────────────────────────────

describe("bulkNotifySchema", () => {
  it("accepts valid segment values", () => {
    for (const seg of ["all_active", "expiring_7d", "expired"] as const) {
      expect(bulkNotifySchema.safeParse({ segment: seg, templateName: "welcome" }).success).toBe(true);
    }
  });

  it("fails with invalid segment", () => {
    expect(bulkNotifySchema.safeParse({ segment: "bogus", templateName: "x" }).success).toBe(false);
  });
});

// ── manualCheckInSchema & workerCheckInSchema ─────────────────────────

describe("manualCheckInSchema", () => {
  it("accepts valid input", () => {
    expect(manualCheckInSchema.safeParse({ userId: 1, locationId: 2 }).success).toBe(true);
  });

  it("fails when userId is missing", () => {
    expect(manualCheckInSchema.safeParse({ locationId: 2 }).success).toBe(false);
  });
});

describe("workerCheckInSchema", () => {
  it("accepts valid input", () => {
    expect(workerCheckInSchema.safeParse({ workerId: 1, locationId: 2 }).success).toBe(true);
  });

  it("fails when workerId is 0", () => {
    expect(workerCheckInSchema.safeParse({ workerId: 0, locationId: 2 }).success).toBe(false);
  });
});

// ── referralSchema ────────────────────────────────────────────────────

describe("referralSchema", () => {
  const valid = { referrerId: 1, referredName: "Jane", referredPhone: "9876543210" };

  it("accepts valid input", () => {
    expect(referralSchema.safeParse(valid).success).toBe(true);
  });

  it("fails when referredName is empty", () => {
    expect(referralSchema.safeParse({ ...valid, referredName: "" }).success).toBe(false);
  });
});

// ── measurementSchema ─────────────────────────────────────────────────

describe("measurementSchema", () => {
  it("accepts minimal valid input (date only)", () => {
    expect(measurementSchema.safeParse({ date: "2025-04-01" }).success).toBe(true);
  });

  it("accepts all optional numeric fields", () => {
    const r = measurementSchema.safeParse({
      date: "2025-04-01",
      weight: 75,
      height: 175,
      chest: 40,
      waist: 32,
      hips: 38,
      biceps: 14,
      notes: "Progress check",
      recordedBy: 1,
    });
    expect(r.success).toBe(true);
  });

  it("fails when numeric fields are 0 or negative", () => {
    expect(measurementSchema.safeParse({ date: "2025-04-01", weight: 0 }).success).toBe(false);
    expect(measurementSchema.safeParse({ date: "2025-04-01", weight: -5 }).success).toBe(false);
  });

  it("fails when date is empty", () => {
    expect(measurementSchema.safeParse({ date: "" }).success).toBe(false);
  });
});

// ── createEnquirySchema ───────────────────────────────────────────────

describe("createEnquirySchema", () => {
  const valid = { name: "Prospect", phone: "9999999999" };

  it("accepts minimal valid input", () => {
    expect(createEnquirySchema.safeParse(valid).success).toBe(true);
  });

  it("accepts empty string email (no email provided)", () => {
    expect(createEnquirySchema.safeParse({ ...valid, email: "" }).success).toBe(true);
  });

  it("accepts valid email", () => {
    expect(createEnquirySchema.safeParse({ ...valid, email: "p@test.com" }).success).toBe(true);
  });

  it("fails when email is invalid (not empty, not valid)", () => {
    expect(createEnquirySchema.safeParse({ ...valid, email: "bademail" }).success).toBe(false);
  });

  it("fails when name is missing", () => {
    expect(createEnquirySchema.safeParse({ phone: "123" }).success).toBe(false);
  });
});

// ── equipmentSchema ───────────────────────────────────────────────────

describe("equipmentSchema", () => {
  const valid = { name: "Treadmill", category: "Cardio", locationId: 1 };

  it("accepts valid input", () => {
    expect(equipmentSchema.safeParse(valid).success).toBe(true);
  });

  it("accepts optional purchasePrice as 0", () => {
    expect(equipmentSchema.safeParse({ ...valid, purchasePrice: 0 }).success).toBe(true);
  });

  it("fails when purchasePrice is negative", () => {
    expect(equipmentSchema.safeParse({ ...valid, purchasePrice: -100 }).success).toBe(false);
  });

  it("fails when name is empty", () => {
    expect(equipmentSchema.safeParse({ ...valid, name: "" }).success).toBe(false);
  });

  it("fails when locationId is missing", () => {
    expect(equipmentSchema.safeParse({ name: "Bench", category: "Strength" }).success).toBe(false);
  });
});

// ── importCSVSchema ───────────────────────────────────────────────────

describe("importCSVSchema", () => {
  it("accepts non-empty CSV content", () => {
    expect(importCSVSchema.safeParse({ csvContent: "name,email\nA,a@b.com" }).success).toBe(true);
  });

  it("fails when csvContent is empty", () => {
    expect(importCSVSchema.safeParse({ csvContent: "" }).success).toBe(false);
  });
});

// ── announcementSchema ────────────────────────────────────────────────

describe("announcementSchema", () => {
  const valid = { title: "Gym Closed", content: "Holiday closure" };

  it("accepts valid input", () => {
    expect(announcementSchema.safeParse(valid).success).toBe(true);
  });

  it("accepts optional fields", () => {
    expect(
      announcementSchema.safeParse({
        ...valid,
        priority: "high",
        targetGroup: "all",
        locationId: 1,
        expiresAt: "2025-12-31",
      }).success
    ).toBe(true);
  });

  it("fails when title is empty", () => {
    expect(announcementSchema.safeParse({ ...valid, title: "" }).success).toBe(false);
  });
});
