import { prisma } from "@/lib/prisma";

export async function getLockers(locationId?: number) {
  const where: Record<string, unknown> = {};
  if (locationId) where.locationId = locationId;

  return prisma.locker.findMany({
    where,
    include: {
      user: { select: { firstname: true, lastname: true, phone: true } },
      location: { select: { name: true } },
    },
    orderBy: { number: "asc" },
  });
}

export async function createLocker(number: string, locationId: number) {
  const existing = await prisma.locker.findUnique({
    where: { number_locationId: { number, locationId } },
  });
  if (existing) return { success: false, error: "Locker number already exists at this location" };

  const locker = await prisma.locker.create({
    data: { number: number.trim(), locationId, status: "available" },
  });
  return { success: true, locker };
}

export async function assignLocker(lockerId: number, userId: number) {
  const locker = await prisma.locker.findUnique({ where: { id: lockerId } });
  if (!locker) return { success: false, error: "Locker not found" };
  if (locker.status !== "available")
    return { success: false, error: "Locker is not available" };

  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.locker.update({
      where: { id: lockerId },
      data: { status: "assigned", assignedTo: userId, assignedAt: new Date() },
    });
    await tx.auditLog.create({
      data: {
        action: "locker_assigned",
        status: "success",
        details: JSON.stringify({ lockerId, userId, lockerNumber: locker.number }),
        actorType: "worker",
      },
    });
    return result;
  });

  return { success: true, locker: updated };
}

export async function releaseLocker(lockerId: number) {
  const locker = await prisma.locker.findUnique({ where: { id: lockerId } });
  if (!locker) return { success: false, error: "Locker not found" };
  if (locker.status !== "assigned")
    return { success: false, error: "Locker is not assigned" };

  const previousUser = locker.assignedTo;

  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.locker.update({
      where: { id: lockerId },
      data: { status: "available", assignedTo: null, assignedAt: null },
    });
    await tx.auditLog.create({
      data: {
        action: "locker_released",
        status: "success",
        details: JSON.stringify({ lockerId, previousUserId: previousUser, lockerNumber: locker.number }),
        actorType: "worker",
      },
    });
    return result;
  });

  return { success: true, locker: updated };
}

export async function setLockerMaintenance(lockerId: number, notes?: string) {
  const locker = await prisma.locker.findUnique({ where: { id: lockerId } });
  if (!locker) return { success: false, error: "Locker not found" };

  const updated = await prisma.locker.update({
    where: { id: lockerId },
    data: {
      status: "maintenance",
      assignedTo: null,
      assignedAt: null,
      notes: notes?.trim() || locker.notes,
    },
  });

  return { success: true, locker: updated };
}

export async function getLockerStats(locationId?: number) {
  const where: Record<string, unknown> = {};
  if (locationId) where.locationId = locationId;

  const lockers = await prisma.locker.groupBy({
    by: ["status"],
    where,
    _count: { status: true },
  });

  const stats = { available: 0, assigned: 0, maintenance: 0, total: 0 };
  for (const row of lockers) {
    const count = row._count.status;
    if (row.status === "available") stats.available = count;
    else if (row.status === "assigned") stats.assigned = count;
    else if (row.status === "maintenance") stats.maintenance = count;
    stats.total += count;
  }
  return stats;
}

export async function markLockerAvailable(lockerId: number) {
  const locker = await prisma.locker.findUnique({ where: { id: lockerId } });
  if (!locker) return { success: false, error: "Locker not found" };
  if (locker.status === "available")
    return { success: false, error: "Locker is already available" };

  const updated = await prisma.locker.update({
    where: { id: lockerId },
    data: { status: "available", assignedTo: null, assignedAt: null },
  });
  return { success: true, locker: updated };
}

export async function deleteLocker(lockerId: number) {
  const locker = await prisma.locker.findUnique({ where: { id: lockerId } });
  if (!locker) return { success: false, error: "Locker not found" };
  if (locker.status !== "available")
    return { success: false, error: "Can only delete available lockers" };

  await prisma.locker.delete({ where: { id: lockerId } });
  return { success: true };
}
