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
  try { await requireWorker(); } catch { return { data: [], total: 0 }; }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = {};
  const status = filters?.status;
  if (status && status !== "all") where.status = status;
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

  const [rows, total] = await Promise.all([
    prisma.enquiry.findMany({
      where,
      include: { location: { select: { name: true } } },
      orderBy,
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.enquiry.count({ where }),
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

  return { data, total };
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
  }
) {
  try { await requireWorker(); } catch { return { error: "Unauthorized" }; }
  const parsed = updateEnquirySchema.safeParse(data);
  if (!parsed.success) return { error: Object.values(zodErrors(parsed.error))[0] };
  const updateData: Record<string, unknown> = {};
  if (data.status !== undefined) updateData.status = data.status;
  if (data.notes !== undefined) updateData.notes = data.notes || null;
  if (data.followUpDate !== undefined)
    updateData.followUpDate = data.followUpDate ? new Date(data.followUpDate) : null;
  if (data.interest !== undefined) updateData.interest = data.interest || null;
  if (data.source !== undefined) updateData.source = data.source;

  await prisma.enquiry.update({ where: { id }, data: updateData });
  revalidatePath("/admin/enquiries");
  revalidateTag("sidebar-counts", "max");
  return { success: true };
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
