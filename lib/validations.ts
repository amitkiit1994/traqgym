import { z } from "zod";

// ── Shared primitives ──────────────────────────────────────────────
const id = z.number().int().positive();
const trimmedString = z.string().trim().min(1);
const optionalTrimmedString = z.string().trim().optional();
const optionalDate = z.string().trim().min(1).optional();
const email = z.string().trim().email();
const password = z.string().min(6, "Password must be at least 6 characters");

// ── Members ────────────────────────────────────────────────────────
export const createMemberSchema = z.object({
  firstname: trimmedString.describe("First name is required"),
  lastname: trimmedString.describe("Last name is required"),
  email: email,
  phone: optionalTrimmedString,
  gender: optionalTrimmedString,
  locationId: z.number().int().positive().nullable().optional(),
});

export const updateMemberSchema = createMemberSchema;

export const importCSVSchema = z.object({
  csvContent: z.string().min(1, "CSV content is required"),
});

// ── Plans ──────────────────────────────────────────────────────────
export const planSchema = z.object({
  name: trimmedString,
  expireDays: z.number().int().positive("Expire days must be positive"),
  price: z.number().positive("Price must be greater than 0"),
  occasions: z.number().int().positive().nullable().optional(),
  joiningFee: z.number().min(0, "Joining fee cannot be negative").optional(),
  joiningFeeAppliesOn: z.enum(["first_only", "every_renewal", "never"]).optional(),
});

// ── Workers ────────────────────────────────────────────────────────
export const createWorkerSchema = z.object({
  email: email,
  password: password,
  firstname: trimmedString,
  lastname: trimmedString,
  role: trimmedString,
  locationId: z.number().int().positive().nullable().optional(),
});

export const updateWorkerSchema = z.object({
  firstname: trimmedString,
  lastname: trimmedString,
  email: email,
  role: trimmedString,
  locationId: z.number().int().positive().nullable().optional(),
  password: z.string().min(6).optional().or(z.literal("")),
});

// ── Renewals ───────────────────────────────────────────────────────
export const renewalSchema = z.object({
  userId: id,
  planId: id,
  locationId: id,
  paymentMode: trimmedString,
  upiReference: optionalTrimmedString,
  promoCode: optionalTrimmedString,
});

// ── Equipment ──────────────────────────────────────────────────────
export const equipmentSchema = z.object({
  name: trimmedString,
  category: trimmedString,
  locationId: id,
  purchaseDate: optionalDate,
  purchasePrice: z.number().min(0).optional(),
  condition: optionalTrimmedString,
  lastServiceDate: optionalDate,
  nextServiceDate: optionalDate,
  notes: optionalTrimmedString,
});

// ── Expenses ───────────────────────────────────────────────────────
export const expenseSchema = z.object({
  category: trimmedString,
  description: trimmedString,
  amount: z.number().positive("Amount must be positive"),
  expenseDate: z.string().min(1, "Date is required"),
  locationId: z.number().int().positive().optional(),
  paidBy: optionalTrimmedString,
  receipt: optionalTrimmedString,
});

// ── Announcements ──────────────────────────────────────────────────
export const announcementSchema = z.object({
  title: trimmedString,
  content: trimmedString,
  priority: optionalTrimmedString,
  targetGroup: optionalTrimmedString,
  locationId: z.number().int().positive().optional(),
  expiresAt: optionalDate,
});

// ── Enquiries ──────────────────────────────────────────────────────
export const createEnquirySchema = z.object({
  name: trimmedString,
  phone: trimmedString,
  email: z.string().trim().email().optional().or(z.literal("")),
  source: optionalTrimmedString,
  interest: optionalTrimmedString,
  locationId: z.number().int().positive().optional(),
  notes: optionalTrimmedString,
  followUpDate: optionalDate,
});

export const updateEnquirySchema = z.object({
  status: optionalTrimmedString,
  notes: z.string().optional(),
  followUpDate: z.string().nullable().optional(),
  interest: optionalTrimmedString,
  source: optionalTrimmedString,
});

// ── Freeze ─────────────────────────────────────────────────────────
export const freezeSchema = z.object({
  userId: id,
  memberTicketId: id,
  freezeStart: z.string().min(1),
  freezeEnd: z.string().min(1),
  reason: optionalTrimmedString,
});

// ── Leaves ─────────────────────────────────────────────────────────
export const leaveRequestSchema = z.object({
  leaveType: trimmedString,
  startDate: z.string().min(1),
  endDate: z.string().min(1),
  reason: optionalTrimmedString,
});

export const reviewLeaveSchema = z.object({
  id: id,
  status: z.enum(["approved", "rejected"]),
  reviewedBy: id,
});

// ── Password ───────────────────────────────────────────────────────
export const resetPasswordSchema = z.object({
  targetId: id,
  newPassword: password,
});

export const changeSelfPasswordSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required"),
  newPassword: password,
});

// ── Promo Codes ────────────────────────────────────────────────────
export const promoCodeSchema = z.object({
  code: trimmedString,
  discountType: z.enum(["percentage", "flat"]),
  discountValue: z.number().positive("Discount value must be positive"),
  maxUses: z.number().int().positive().optional(),
  validFrom: z.string().min(1),
  validTo: z.string().min(1),
  planIds: optionalTrimmedString,
});

// ── Referrals ──────────────────────────────────────────────────────
export const referralSchema = z.object({
  referrerId: id,
  referredName: trimmedString,
  referredPhone: trimmedString,
});

// ── Measurements ───────────────────────────────────────────────────
export const measurementSchema = z.object({
  date: z.string().min(1),
  weight: z.number().positive().optional(),
  height: z.number().positive().optional(),
  chest: z.number().positive().optional(),
  waist: z.number().positive().optional(),
  hips: z.number().positive().optional(),
  biceps: z.number().positive().optional(),
  notes: optionalTrimmedString,
  recordedBy: z.number().int().positive().optional(),
});

// ── Locations ──────────────────────────────────────────────────────
export const locationSchema = z.object({
  name: trimmedString,
  code: trimmedString,
  address: optionalTrimmedString,
  phone: optionalTrimmedString,
});

export const openingHoursSchema = z.array(
  z.object({
    dayOfWeek: z.number().int().min(0).max(6),
    openTime: z.string(),
    closeTime: z.string(),
    isClosed: z.boolean(),
  })
).length(7, "Must provide all 7 days");

// ── Classes ────────────────────────────────────────────────────────
export const classSchema = z.object({
  name: trimmedString,
  description: optionalTrimmedString,
  classType: optionalTrimmedString,
  instructorId: z.number().int().positive().nullable().optional(),
  locationId: id,
  maxCapacity: z.number().int().positive("Max capacity must be positive"),
  schedules: z.array(
    z.object({
      dayOfWeek: z.number().int().min(0).max(6),
      startTime: z.string().min(1),
      endTime: z.string().min(1),
    })
  ).min(1, "At least one schedule is required"),
});

// ── Bulk Notify ────────────────────────────────────────────────────
export const bulkNotifySchema = z.object({
  segment: z.enum(["all_active", "expiring_7d", "expired"]),
  templateName: trimmedString,
  customMessage: optionalTrimmedString,
});

// ── Attendance ─────────────────────────────────────────────────────
export const manualCheckInSchema = z.object({
  userId: id,
  locationId: id,
});

export const workerCheckInSchema = z.object({
  workerId: id,
  locationId: id,
});

// ── Helper: Convert Zod errors to Record<string, string> ──────────
export function zodErrors(error: z.ZodError): Record<string, string> {
  const result: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path[0]?.toString() || "_form";
    if (!result[key]) {
      result[key] = issue.message;
    }
  }
  return result;
}
