"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath, revalidateTag } from "next/cache";
import { requireWorker } from "@/lib/auth-guard";
import { createEnquirySchema, updateEnquirySchema, zodErrors } from "@/lib/validations";

export async function getEnquiries(filters?: {
  status?: string;
  locationId?: number;
  showArchived?: boolean;
  search?: string;
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}) {
  try { await requireWorker(); } catch { return { data: [], total: 0, hiddenClosedCount: 0 }; }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = {};
  const status = filters?.status;
  if (status === "overdue") {
    // Match daily-actions query: actionable statuses, not updated in 2+ days
    where.status = { in: ["new", "follow_up", "interested"] };
    where.updatedAt = { lt: new Date(Date.now() - 2 * 86400000) };
  } else if (status && status !== "all") {
    where.status = status;
  } else if ((!status || status === "all") && !filters?.showArchived) {
    where.status = { notIn: ["converted", "lost"] };
  }
  if (filters?.locationId) where.locationId = filters.locationId;

  // Default: scope to recent enquiries (created within 120 days)
  // Hides ancient migrated data that's not actionable
  if (!filters?.showArchived) {
    const oneHundredTwentyDaysAgo = new Date();
    oneHundredTwentyDaysAgo.setDate(oneHundredTwentyDaysAgo.getDate() - 120);
    where.createdAt = { gte: oneHundredTwentyDaysAgo };
  }

  // Search by name or phone
  if (filters?.search) {
    const q = filters.search.trim();
    if (q) {
      where.OR = [
        { name: { contains: q, mode: "insensitive" } },
        { phone: { contains: q } },
      ];
    }
  }

  // Build orderBy
  const sortField = filters?.sortBy || "createdAt";
  const sortDir = filters?.sortOrder || "desc";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let orderBy: any;
  if (sortField === "name" || sortField === "phone" || sortField === "source" || sortField === "status" || sortField === "followUpDate" || sortField === "createdAt") {
    orderBy = { [sortField]: sortDir };
  } else {
    orderBy = { createdAt: "desc" };
  }

  const page = filters?.page ?? 1;
  const pageSize = filters?.pageSize ?? 25;

  const isAllFilter = !status || status === "all";
  const showHiddenHint = isAllFilter && !filters?.showArchived;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const hiddenClosedWhere: any = { ...where };
  hiddenClosedWhere.status = { in: ["converted", "lost"] };

  const [rows, total, hiddenClosedCount] = await Promise.all([
    prisma.enquiry.findMany({
      where,
      include: { location: { select: { name: true } } },
      orderBy,
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.enquiry.count({ where }),
    showHiddenHint ? prisma.enquiry.count({ where: hiddenClosedWhere }) : Promise.resolve(0),
  ]);

  const data = rows.map((r) => ({
    id: r.id,
    name: r.name,
    phone: r.phone,
    email: r.email,
    source: r.source,
    interest: r.interest,
    locationName: r.location?.name ?? null,
    locationId: r.locationId,
    status: r.status,
    followUpDate: r.followUpDate?.toISOString() ?? null,
    notes: r.notes,
    assignedTo: r.assignedTo,
    convertedUserId: r.convertedUserId,
    createdAt: r.createdAt.toISOString(),
  }));

  return { data, total, hiddenClosedCount };
}

export async function createEnquiry(data: {
  name: string;
  phone: string;
  email?: string;
  source?: string;
  interest?: string;
  locationId?: number;
  notes?: string;
  followUpDate?: string;
}) {
  try { await requireWorker(); } catch { return { error: "Unauthorized" }; }
  const parsed = createEnquirySchema.safeParse(data);
  if (!parsed.success) return { error: Object.values(zodErrors(parsed.error))[0] };

  await prisma.enquiry.create({
    data: {
      name: data.name.trim(),
      phone: data.phone.trim(),
      email: data.email?.trim() || null,
      source: data.source || "walk_in",
      interest: data.interest?.trim() || null,
      locationId: data.locationId || null,
      notes: data.notes?.trim() || null,
      followUpDate: data.followUpDate ? new Date(data.followUpDate) : null,
    },
  });

  // In-app notification for admins (fire-and-forget)
  try {
    const { notifyWorkersByRole } = await import("@/lib/services/in-app-notification");
    await notifyWorkersByRole({
      role: "admin",
      type: "new_enquiry",
      title: `New enquiry from ${data.name.trim()}`,
      message: data.phone.trim(),
      link: "/admin/enquiries",
    });
  } catch {}

  revalidatePath("/admin/enquiries");
  revalidateTag("sidebar-counts", "max");
  return { success: true };
}

export async function updateEnquiry(
  id: number,
  data: {
    status?: string;
    notes?: string;
    followUpDate?: string | null;
    interest?: string;
    source?: string;
    assignedTo?: number | null;
    // Follow-up fields (H8 fix): when provided, atomically create
    // an EnquiryFollowup row alongside the status update so admin
    // staff can record next-action / outcome / note from the edit dialog.
    followupNote?: string;
    followupAction?: string;
    followupOutcome?: string;
    nextFollowupAt?: string | null;
  }
) {
  let session;
  try {
    session = await requireWorker();
  } catch {
    return { error: "Unauthorized" };
  }
  // Validate the subset of fields the existing schema knows about.
  // Extra fields (followupNote, nextFollowupAt, etc.) are ignored by
  // safeParse so they pass through untouched.
  const parsed = updateEnquirySchema.safeParse(data);
  if (!parsed.success) return { error: Object.values(zodErrors(parsed.error))[0] };

  const updateData: Record<string, unknown> = {};
  if (data.status !== undefined) updateData.status = data.status;
  if (data.notes !== undefined) updateData.notes = data.notes || null;
  if (data.followUpDate !== undefined)
    updateData.followUpDate = data.followUpDate ? new Date(data.followUpDate) : null;
  if (data.interest !== undefined) updateData.interest = data.interest || null;
  if (data.source !== undefined) updateData.source = data.source;
  if (data.assignedTo !== undefined) updateData.assignedTo = data.assignedTo;

  // Decide whether the staff is recording a follow-up. We only create
  // an EnquiryFollowup row when at least one of: a non-empty note,
  // a next-action date, or an explicit outcome is supplied. Status-only
  // edits must not create empty followup rows.
  const trimmedNote = (data.followupNote ?? "").trim();
  const hasNextDate = !!data.nextFollowupAt;
  const hasOutcome = !!data.followupOutcome;
  const shouldCreateFollowup = trimmedNote.length > 0 || hasNextDate || hasOutcome;

  const workerIdRaw = session?.user?.id ? parseInt(session.user.id, 10) : NaN;
  const hasWorker = Number.isFinite(workerIdRaw);

  await prisma.$transaction(async (tx) => {
    if (Object.keys(updateData).length > 0) {
      await tx.enquiry.update({ where: { id }, data: updateData });
    }

    if (shouldCreateFollowup && hasWorker) {
      // Resolve the action/outcome with sensible defaults so the row
      // satisfies the schema's NOT NULL constraints. The caller may
      // override either via followupAction / followupOutcome.
      const action = (data.followupAction || "call").trim();
      const outcome = (data.followupOutcome || inferOutcomeFromStatus(data.status)).trim();

      await tx.enquiryFollowup.create({
        data: {
          enquiryId: id,
          workerId: workerIdRaw,
          action,
          outcome,
          notes: trimmedNote || null,
          nextFollowupAt: data.nextFollowupAt ? new Date(data.nextFollowupAt) : null,
        },
      });

      await tx.auditLog.create({
        data: {
          action: "enquiry_followup_added",
          status: "success",
          actorId: workerIdRaw,
          actorType: "worker",
          details: JSON.stringify({
            enquiryId: id,
            outcome,
            followAction: action,
            hasNote: trimmedNote.length > 0,
            nextFollowupAt: data.nextFollowupAt ?? null,
          }),
        },
      });
    }
  });

  revalidatePath("/admin/enquiries");
  revalidateTag("sidebar-counts", "max");
  return { success: true };
}

// Map an Enquiry.status into a sensible EnquiryFollowup.outcome when the
// dialog does not pass one explicitly. Mirrors the values used by
// lib/services/enquiry-followup.ts (call/visit/whatsapp + interested/
// not_interested/no_answer/callback/visited/converted).
function inferOutcomeFromStatus(status?: string): string {
  switch (status) {
    case "converted":
      return "converted";
    case "lost":
      return "not_interested";
    case "contacted":
      return "interested";
    case "follow_up":
      return "callback";
    default:
      return "interested";
  }
}

export async function convertEnquiry(enquiryId: number) {
  try { await requireWorker(); } catch { return { error: "Unauthorized" }; }

  const enquiry = await prisma.enquiry.findUnique({ where: { id: enquiryId } });
  if (!enquiry) return { error: "Enquiry not found" };
  if (enquiry.convertedUserId) return { error: "Already converted" };

  // Split name into firstname/lastname
  const parts = enquiry.name.trim().split(/\s+/);
  const firstname = parts[0] || "Member";
  const lastname = parts.slice(1).join(" ") || "";

  // Check if email or phone already exists
  if (enquiry.email) {
    const existing = await prisma.user.findUnique({ where: { email: enquiry.email } });
    if (existing) return { error: "A member with this email already exists" };
  }

  // Generate email if not provided
  const email = enquiry.email || `${enquiry.phone}@member.local`;

  // Create user with default password = phone number
  const bcrypt = require("bcryptjs");
  const hashedPassword = await bcrypt.hash(enquiry.phone, 10);

  const user = await prisma.user.create({
    data: {
      email,
      password: hashedPassword,
      firstname,
      lastname,
      phone: enquiry.phone,
      locationId: enquiry.locationId,
    },
  });

  // Update enquiry status
  await prisma.enquiry.update({
    where: { id: enquiryId },
    data: { status: "converted", convertedUserId: user.id },
  });

  // Audit log
  await prisma.auditLog.create({
    data: {
      action: "enquiry_conversion",
      status: "success",
      details: JSON.stringify({ enquiryId, userId: user.id, name: enquiry.name }),
      actorType: "worker",
    },
  });

  revalidatePath("/admin/enquiries");
  revalidateTag("sidebar-counts", "max");
  return { success: true, userId: user.id };
}
