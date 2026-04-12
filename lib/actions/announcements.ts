"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { requireWorker } from "@/lib/auth-guard";
import { announcementSchema, zodErrors } from "@/lib/validations";

export async function getAnnouncements(targetGroup?: string, locationId?: number) {
  try { await requireWorker(); } catch { return []; }
  const now = new Date();
  const where: Record<string, unknown> = {
    isActive: true,
    OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
  };

  if (targetGroup) {
    where.targetGroup = { in: [targetGroup, "all"] };
  }

  if (locationId) {
    where.AND = [
      { OR: [{ locationId: null }, { locationId }] },
    ];
  }

  const announcements = await prisma.announcement.findMany({
    where,
    include: { location: { select: { name: true } } },
    orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
  });

  return announcements.map((a) => ({
    id: a.id,
    title: a.title,
    content: a.content,
    priority: a.priority,
    targetGroup: a.targetGroup,
    locationId: a.locationId,
    locationName: a.location?.name ?? "All",
    isActive: a.isActive,
    expiresAt: a.expiresAt?.toISOString() ?? null,
    createdAt: a.createdAt.toISOString(),
  }));
}

export async function getAllAnnouncements() {
  try { await requireWorker(); } catch { return []; }
  const announcements = await prisma.announcement.findMany({
    include: { location: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
  });

  return announcements.map((a) => ({
    id: a.id,
    title: a.title,
    content: a.content,
    priority: a.priority,
    targetGroup: a.targetGroup,
    locationId: a.locationId,
    locationName: a.location?.name ?? "All",
    isActive: a.isActive,
    expiresAt: a.expiresAt?.toISOString() ?? null,
    createdAt: a.createdAt.toISOString(),
  }));
}

export async function createAnnouncement(data: {
  title: string;
  content: string;
  priority?: string;
  targetGroup?: string;
  locationId?: number;
  expiresAt?: string;
}) {
  try { await requireWorker(); } catch { return { error: "Unauthorized" }; }
  const parsed = announcementSchema.safeParse(data);
  if (!parsed.success) return { errors: zodErrors(parsed.error) };

  await prisma.announcement.create({
    data: {
      title: data.title.trim(),
      content: data.content.trim(),
      priority: data.priority || "normal",
      targetGroup: data.targetGroup || "all",
      locationId: data.locationId || null,
      expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
    },
  });

  // In-app notification for all active members (fire-and-forget)
  try {
    const activeUsers = await prisma.user.findMany({
      where: { isActive: true },
      select: { id: true },
    });
    if (activeUsers.length > 0) {
      await prisma.inAppNotification.createMany({
        data: activeUsers.map((u) => ({
          userId: u.id,
          type: "new_announcement",
          title: data.title.trim(),
          message: data.content.trim().slice(0, 200),
          link: "/member/announcements",
        })),
      });
    }
  } catch {}

  revalidatePath("/admin/announcements");
  return { success: true };
}

export async function toggleAnnouncement(id: number) {
  try { await requireWorker(); } catch { return { error: "Unauthorized" }; }
  const announcement = await prisma.announcement.findUnique({ where: { id } });
  if (!announcement) return { errors: { _form: "Announcement not found" } };

  await prisma.announcement.update({
    where: { id },
    data: { isActive: !announcement.isActive },
  });

  revalidatePath("/admin/announcements");
  return { success: true };
}
