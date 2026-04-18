"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath, revalidateTag } from "next/cache";
import bcrypt from "bcryptjs";
import { requireWorker } from "@/lib/auth-guard";
import { createMemberSchema, zodErrors } from "@/lib/validations";
import { calculateChurnRiskBatch } from "@/lib/services/churn-risk";

export async function getMembers(params?: string | { search?: string; page?: number; pageSize?: number; status?: "active" | "expired" | "no_plan" | "expiring" | "inactive"; birthday?: string; sortBy?: "name" | "status" | "location"; sortOrder?: "asc" | "desc"; showAllExpired?: boolean; planId?: number }) {
  try { await requireWorker(); } catch { return { members: [], total: 0 }; }

  // Support legacy call signature: getMembers("searchTerm")
  const search = typeof params === "string" ? params : params?.search;
  const page = (typeof params === "object" ? params?.page : undefined) ?? 1;
  const pageSize = (typeof params === "object" ? params?.pageSize : undefined) ?? 25;
  const statusFilter = typeof params === "object" ? params?.status : undefined;
  const birthdayFilter = typeof params === "object" ? params?.birthday : undefined;
  const sortBy = (typeof params === "object" ? params?.sortBy : undefined) ?? "name";
  const sortOrder = (typeof params === "object" ? params?.sortOrder : undefined) ?? "asc";
  const showAllExpired = typeof params === "object" ? params?.showAllExpired : undefined;
  const planFilter = typeof params === "object" ? params?.planId : undefined;
  const skip = (page - 1) * pageSize;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = {};

  if (search) {
    where.OR = [
      { firstname: { contains: search, mode: "insensitive" as const } },
      { lastname: { contains: search, mode: "insensitive" as const } },
      { email: { contains: search, mode: "insensitive" as const } },
      { phone: { contains: search } },
    ];
  }

  if (statusFilter === "active") {
    where.memberTickets = {
      some: {
        expireDate: { gte: today },
        status: "active",
      },
    };
  } else if (statusFilter === "expired") {
    const ninetyDaysAgo = new Date(today.getTime() - 90 * 86400000);
    where.memberTickets = {
      some: {
        ...(!showAllExpired ? { expireDate: { gte: ninetyDaysAgo, lt: today } } : {}),
      },
    };
    where.NOT = {
      memberTickets: {
        some: {
          expireDate: { gte: today },
          status: "active",
        },
      },
    };
  } else if (statusFilter === "no_plan") {
    where.memberTickets = { none: {} };
  } else if (statusFilter === "expiring") {
    const threeDaysFromNow = new Date(today.getTime() + 3 * 86400000);
    where.memberTickets = {
      some: {
        expireDate: { gte: today, lte: threeDaysFromNow },
        status: "active",
      },
    };
  } else if (statusFilter === "inactive") {
    const sevenDaysAgo = new Date(today.getTime() - 7 * 86400000);
    where.memberTickets = {
      some: {
        expireDate: { gte: today },
        status: "active",
      },
    };
    where.attendanceLogs = {
      none: { checkIn: { gte: sevenDaysAgo } },
    };
  }

  // Plan filter: restrict to members with an active ticket on the selected plan.
  // Compose with any existing memberTickets `some` clause from status filters.
  if (planFilter !== undefined && Number.isFinite(planFilter)) {
    const existingSome = (where.memberTickets && typeof where.memberTickets === "object" && "some" in where.memberTickets)
      ? where.memberTickets.some
      : undefined;
    where.memberTickets = {
      some: {
        ...(existingSome ?? {}),
        planId: planFilter,
        status: "active",
      },
    };
  }

  // Birthday filter: fetch all matching users with birthdate, then filter in JS
  if (birthdayFilter === "today") {
    where.birthdate = { not: null };
  }

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      include: {
        location: true,
        memberTickets: {
          orderBy: { expireDate: "desc" },
          take: 1,
          include: {
            plan: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: sortBy === "location"
        ? { location: { name: sortOrder } }
        : { firstname: sortOrder },
      ...(birthdayFilter !== "today" ? { skip, take: pageSize } : {}),
    }),
    prisma.user.count({ where }),
  ]);

  let filteredUsers = users;
  if (birthdayFilter === "today") {
    const todayMonth = today.getMonth();
    const todayDay = today.getDate();
    filteredUsers = users.filter((u) => {
      if (!u.birthdate) return false;
      const bd = new Date(u.birthdate);
      return bd.getMonth() === todayMonth && bd.getDate() === todayDay;
    });
    // Manual pagination for birthday filter
    const birthdayTotal = filteredUsers.length;
    filteredUsers = filteredUsers.slice(skip, skip + pageSize);

    const memberIds = filteredUsers.map((u) => u.id);
    const riskMap = await calculateChurnRiskBatch(memberIds);

    const members = filteredUsers.map((user) => {
      let status: "active" | "expired" | "no_plan" = "no_plan";
      let planId: number | null = null;
      let planName: string | null = null;
      if (user.memberTickets.length > 0) {
        const latest = user.memberTickets[0];
        status = new Date(latest.expireDate) >= today ? "active" : "expired";
        if (status === "active") {
          planId = latest.plan?.id ?? null;
          planName = latest.plan?.name ?? null;
        }
      }
      const risk = riskMap.get(user.id);
      return {
        id: user.id,
        firstname: user.firstname,
        lastname: user.lastname,
        email: user.email,
        phone: user.phone,
        locationName: user.location?.name ?? "N/A",
        status,
        planId,
        planName,
        riskLevel: risk?.level ?? ("low" as const),
        riskReason: risk?.reason ?? "",
      };
    });

    return { members, total: birthdayTotal };
  }

  const memberIds = users.map((u) => u.id);
  const riskMap = await calculateChurnRiskBatch(memberIds);

  const members = users.map((user) => {
    let status: "active" | "expired" | "no_plan" = "no_plan";
    let planId: number | null = null;
    let planName: string | null = null;
    if (user.memberTickets.length > 0) {
      const latest = user.memberTickets[0];
      status = new Date(latest.expireDate) >= today ? "active" : "expired";
      if (status === "active") {
        planId = latest.plan?.id ?? null;
        planName = latest.plan?.name ?? null;
      }
    }
    const risk = riskMap.get(user.id);
    return {
      id: user.id,
      firstname: user.firstname,
      lastname: user.lastname,
      email: user.email,
      phone: user.phone,
      locationName: user.location?.name ?? "N/A",
      status,
      planId,
      planName,
      riskLevel: risk?.level ?? ("low" as const),
      riskReason: risk?.reason ?? "",
    };
  });

  return { members, total };
}

export async function getMember(id: number) {
  try { await requireWorker(); } catch { return null; }
  const user = await prisma.user.findUnique({
    where: { id },
    include: {
      location: true,
      memberTickets: {
        include: { plan: true },
        orderBy: { buyDate: "desc" },
      },
      attendanceLogs: {
        orderBy: { checkIn: "desc" },
        take: 5,
        include: { location: true },
      },
    },
  });
  if (!user) return null;
  return user;
}

export async function createMember(data: {
  firstname: string;
  lastname: string;
  email: string;
  phone?: string;
  gender?: string;
  locationId?: number | null;
}) {
  try { await requireWorker(); } catch { return { error: "Unauthorized" }; }
  const parsed = createMemberSchema.safeParse(data);
  if (!parsed.success) return { errors: zodErrors(parsed.error) };

  const existing = await prisma.user.findUnique({
    where: { email: data.email.trim() },
  });
  if (existing) return { errors: { email: "Email already in use" } };

  // Check duplicate phone
  if (data.phone?.trim()) {
    const phoneExists = await prisma.user.findFirst({
      where: { phone: data.phone.trim() },
    });
    if (phoneExists) return { errors: { phone: "A member with this phone number already exists" } };
  }

  const rawPassword = data.phone?.trim() || "welcome123";
  const hashedPassword = await bcrypt.hash(rawPassword, 10);

  const user = await prisma.user.create({
    data: {
      firstname: data.firstname.trim(),
      lastname: data.lastname.trim(),
      email: data.email.trim(),
      password: hashedPassword,
      phone: data.phone?.trim() || null,
      gender: data.gender?.trim() || null,
      locationId: data.locationId ?? null,
    },
  });

  // Send welcome notification (non-blocking, respects settings)
  try {
    const { getSetting } = await import("@/lib/services/settings");
    const welcomeEnabled = await getSetting("welcome_message_enabled", "true");
    if (welcomeEnabled === "true" && data.phone) {
      const { dispatch, markSent, markFailed } = await import("@/lib/services/notification");
      const whatsapp = await import("@/lib/channels/whatsapp");
      const smsChannel = await import("@/lib/channels/sms");
      const channel = await getSetting("notification_channel", "whatsapp");

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const variables = { memberName: `${data.firstname} ${data.lastname}` };

      if (channel === "whatsapp" || channel === "both") {
        const notif = await dispatch({
          userId: user.id,
          templateName: "welcome_new_member",
          channel: "whatsapp",
          recipient: data.phone,
          deliveryDate: today,
        });
        if (!notif.skipped) {
          const result = await whatsapp.send({ recipient: data.phone, templateName: "welcome_new_member", variables });
          if (result.success) await markSent(notif.id);
          else await markFailed(notif.id, result.error || "Send failed");
        }
      }

      if (channel === "sms" || channel === "both") {
        const notif = await dispatch({
          userId: user.id,
          templateName: "welcome_new_member_sms",
          channel: "sms",
          recipient: data.phone,
          deliveryDate: today,
        });
        if (!notif.skipped) {
          const result = await smsChannel.send({ recipient: data.phone, templateName: "welcome_new_member_sms", variables });
          if (result.success) await markSent(notif.id);
          else await markFailed(notif.id, result.error || "Send failed");
        }
      }
    }
  } catch (err) {
    console.error("[New Member] Welcome notification failed:", err);
  }

  revalidatePath("/admin/members");
  revalidateTag("members", "max");
  revalidateTag("dashboard", "max");
  revalidateTag("sidebar-counts", "max");
  return { success: true };
}

export async function importMembersFromCSV(csvContent: string) {
  try { await requireWorker(); } catch { return { error: "Unauthorized", created: 0, skipped: 0, errors: [] }; }
  // Expected CSV format: firstname,lastname,email,phone,gender,location_code
  // First line is header
  // Password: phone number or "welcome123"
  // location_code maps to Location.code (e.g., "MAIN", "CC")

  const lines = csvContent.trim().split("\n");
  const dataLines = lines.slice(1).filter((l) => l.trim());

  let created = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (let i = 0; i < dataLines.length; i++) {
    const parts = dataLines[i].split(",").map((p) => p.trim());
    if (parts.length < 3) {
      errors.push(`Row ${i + 2}: not enough columns`);
      continue;
    }

    const [firstname, lastname, email, phone, gender, locationCode] = parts;

    // Check email unique
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      skipped++;
      continue;
    }

    // Check phone unique
    if (phone) {
      const phoneExists = await prisma.user.findFirst({ where: { phone } });
      if (phoneExists) {
        skipped++;
        continue;
      }
    }

    // Find location by code
    let locationId: number | null = null;
    if (locationCode) {
      const loc = await prisma.location.findUnique({
        where: { code: locationCode },
      });
      if (loc) locationId = loc.id;
    }

    // Hash password
    const password = phone || "welcome123";
    const hash = await bcrypt.hash(password, 10);

    await prisma.user.create({
      data: {
        firstname,
        lastname,
        email,
        phone: phone || null,
        gender: gender || null,
        locationId,
        password: hash,
      },
    });
    created++;
  }

  return { created, skipped, errors };
}

export async function updateMember(
  id: number,
  data: {
    firstname: string;
    lastname: string;
    email: string;
    phone?: string;
    gender?: string;
    locationId?: number | null;
  }
) {
  try { await requireWorker(); } catch { return { error: "Unauthorized" }; }
  const parsed = createMemberSchema.safeParse(data);
  if (!parsed.success) return { errors: zodErrors(parsed.error) };

  const existing = await prisma.user.findFirst({
    where: { email: data.email.trim(), NOT: { id } },
  });
  if (existing) return { errors: { email: "Email already in use" } };

  await prisma.user.update({
    where: { id },
    data: {
      firstname: data.firstname.trim(),
      lastname: data.lastname.trim(),
      email: data.email.trim(),
      phone: data.phone?.trim() || null,
      gender: data.gender?.trim() || null,
      locationId: data.locationId ?? null,
    },
  });
  revalidatePath(`/admin/members/${id}`);
  revalidatePath("/admin/members");
  revalidateTag("members", "max");
  revalidateTag("dashboard", "max");
  revalidateTag("sidebar-counts", "max");
  return { success: true };
}

export async function toggleMemberActive(id: number) {
  try { await requireWorker(); } catch { return { success: false, error: "Unauthorized" }; }

  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) return { success: false, error: "Member not found" };

  const newActive = !user.isActive;
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id },
      data: { isActive: newActive },
    });
    await tx.auditLog.create({
      data: {
        action: newActive ? "member_reactivated" : "member_deactivated",
        status: "success",
        details: JSON.stringify({ userId: id, name: `${user.firstname} ${user.lastname}` }),
        actorType: "worker",
      },
    });
  });

  revalidatePath(`/admin/members/${id}`);
  revalidatePath("/admin/members");
  revalidateTag("members", "max");
  revalidateTag("dashboard", "max");
  revalidateTag("sidebar-counts", "max");
  return { success: true, isActive: newActive };
}

export async function transferMember(data: {
  userId: number;
  toLocationId: number;
  ticketId: number;
}) {
  let session;
  try { session = await requireWorker(["admin"]); } catch { return { success: false, error: "Unauthorized" }; }

  const { transferMember: doTransfer } = await import("@/lib/services/member-transfer");
  const result = await doTransfer({
    ...data,
    transferredBy: Number(session.user.id),
  });

  if (result.success) {
    revalidatePath(`/admin/members/${data.userId}`);
    revalidatePath("/admin/members");
    revalidateTag("members", "max");
    revalidateTag("dashboard", "max");
    revalidateTag("sidebar-counts", "max");
  }

  return result;
}

export async function cancelMembership(ticketId: number) {
  try { await requireWorker(); } catch { return { success: false, error: "Unauthorized" }; }

  const ticket = await prisma.memberTicket.findUnique({ where: { id: ticketId } });
  if (!ticket) return { success: false, error: "Membership not found" };
  if (ticket.status === "cancelled") return { success: false, error: "Already cancelled" };

  await prisma.memberTicket.update({
    where: { id: ticketId },
    data: { status: "cancelled", cancelledAt: new Date() },
  });

  revalidatePath(`/admin/members/${ticket.userId}`);
  revalidateTag("members", "max");
  revalidateTag("dashboard", "max");
  revalidateTag("sidebar-counts", "max");
  return { success: true };
}
