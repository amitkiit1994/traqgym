import { prisma } from "@/lib/prisma";
import { todayIST } from "@/lib/utils/date";

export async function createClass(params: {
  name: string;
  description?: string;
  classType?: string;
  instructorId?: number;
  locationId: number;
  maxCapacity: number;
  schedules: { dayOfWeek: number; startTime: string; endTime: string }[];
}) {
  if (!params.name.trim()) return { success: false, error: "Name is required" };
  if (!params.locationId) return { success: false, error: "Location is required" };
  if (params.maxCapacity < 1) return { success: false, error: "Capacity must be at least 1" };

  const gymClass = await prisma.gymClass.create({
    data: {
      name: params.name.trim(),
      description: params.description?.trim() || null,
      classType: params.classType || "group",
      instructorId: params.instructorId || null,
      locationId: params.locationId,
      maxCapacity: params.maxCapacity,
      schedules: {
        create: params.schedules.map((s) => ({
          dayOfWeek: s.dayOfWeek,
          startTime: s.startTime,
          endTime: s.endTime,
        })),
      },
    },
    include: { schedules: true },
  });

  return { success: true, gymClass };
}

export async function updateClass(
  id: number,
  params: {
    name: string;
    description?: string;
    classType?: string;
    instructorId?: number | null;
    locationId: number;
    maxCapacity: number;
    schedules: { dayOfWeek: number; startTime: string; endTime: string }[];
  }
) {
  if (!params.name.trim()) return { success: false, error: "Name is required" };

  await prisma.$transaction(async (tx) => {
    await tx.gymClass.update({
      where: { id },
      data: {
        name: params.name.trim(),
        description: params.description?.trim() || null,
        classType: params.classType || "group",
        instructorId: params.instructorId ?? null,
        locationId: params.locationId,
        maxCapacity: params.maxCapacity,
      },
    });

    // Replace schedules
    await tx.classSchedule.deleteMany({ where: { classId: id } });
    await tx.classSchedule.createMany({
      data: params.schedules.map((s) => ({
        classId: id,
        dayOfWeek: s.dayOfWeek,
        startTime: s.startTime,
        endTime: s.endTime,
      })),
    });
  });

  return { success: true };
}

export async function toggleClassActive(id: number) {
  const existing = await prisma.gymClass.findUnique({ where: { id } });
  if (!existing) return { success: false, error: "Class not found" };

  await prisma.gymClass.update({
    where: { id },
    data: { isActive: !existing.isActive },
  });

  return { success: true };
}

export async function getClasses(locationId?: number) {
  const where = locationId ? { locationId } : {};
  return prisma.gymClass.findMany({
    where,
    include: {
      location: { select: { name: true } },
      instructor: { select: { firstname: true, lastname: true } },
      schedules: { orderBy: { dayOfWeek: "asc" as const } },
      _count: { select: { bookings: true } },
    },
    orderBy: { name: "asc" },
  });
}

export async function getClassById(id: number) {
  return prisma.gymClass.findUnique({
    where: { id },
    include: {
      location: { select: { name: true } },
      instructor: { select: { firstname: true, lastname: true } },
      schedules: { orderBy: { dayOfWeek: "asc" as const } },
    },
  });
}

export async function bookClass(params: {
  classId: number;
  userId: number;
  scheduleDate: Date;
}) {
  const gymClass = await prisma.gymClass.findUnique({
    where: { id: params.classId },
  });
  if (!gymClass) return { success: false, error: "Class not found" };
  if (!gymClass.isActive) return { success: false, error: "Class is not active" };

  // Check capacity
  const bookedCount = await prisma.classBooking.count({
    where: {
      classId: params.classId,
      scheduleDate: params.scheduleDate,
      status: { in: ["booked", "attended"] },
    },
  });
  if (bookedCount >= gymClass.maxCapacity) {
    return { success: false, error: "Class is full" };
  }

  // Check duplicate
  const existing = await prisma.classBooking.findUnique({
    where: {
      classId_userId_scheduleDate: {
        classId: params.classId,
        userId: params.userId,
        scheduleDate: params.scheduleDate,
      },
    },
  });
  if (existing && existing.status !== "cancelled") {
    return { success: false, error: "Already booked for this class on this date" };
  }

  if (existing && existing.status === "cancelled") {
    // Re-book a cancelled booking
    await prisma.classBooking.update({
      where: { id: existing.id },
      data: { status: "booked" },
    });
    return { success: true };
  }

  await prisma.classBooking.create({
    data: {
      classId: params.classId,
      userId: params.userId,
      scheduleDate: params.scheduleDate,
      status: "booked",
    },
  });

  return { success: true };
}

export async function cancelBooking(bookingId: number, userId: number) {
  const booking = await prisma.classBooking.findUnique({
    where: { id: bookingId },
  });
  if (!booking) return { success: false, error: "Booking not found" };
  if (booking.userId !== userId)
    return { success: false, error: "Booking does not belong to this user" };
  if (booking.status === "cancelled")
    return { success: false, error: "Booking already cancelled" };

  await prisma.classBooking.update({
    where: { id: bookingId },
    data: { status: "cancelled" },
  });

  return { success: true };
}

export async function getClassBookings(classId: number, date: Date) {
  return prisma.classBooking.findMany({
    where: {
      classId,
      scheduleDate: date,
      status: { in: ["booked", "attended"] },
    },
    include: {
      user: { select: { firstname: true, lastname: true, phone: true } },
    },
    orderBy: { createdAt: "asc" },
  });
}

export async function getUpcomingClasses(locationId?: number) {
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0=Sun

  const where: Record<string, unknown> = { isActive: true };
  if (locationId) where.locationId = locationId;

  const classes = await prisma.gymClass.findMany({
    where: {
      ...where,
      schedules: { some: { dayOfWeek } },
    },
    include: {
      location: { select: { name: true } },
      instructor: { select: { firstname: true, lastname: true } },
      schedules: {
        where: { dayOfWeek },
        orderBy: { startTime: "asc" },
      },
      bookings: {
        where: {
          scheduleDate: new Date(now.getFullYear(), now.getMonth(), now.getDate()),
          status: { in: ["booked", "attended"] },
        },
      },
    },
    orderBy: { name: "asc" },
  });

  return classes.map((c) => ({
    id: c.id,
    name: c.name,
    classType: c.classType,
    locationName: c.location.name,
    instructorName: c.instructor
      ? `${c.instructor.firstname} ${c.instructor.lastname}`
      : null,
    maxCapacity: c.maxCapacity,
    schedules: c.schedules,
    bookedCount: c.bookings.length,
    spotsLeft: c.maxCapacity - c.bookings.length,
  }));
}

export async function getMemberBookings(userId: number) {
  const today = todayIST();

  return prisma.classBooking.findMany({
    where: {
      userId,
      scheduleDate: { gte: today },
      status: { in: ["booked", "attended"] },
    },
    include: {
      gymClass: {
        select: {
          name: true,
          classType: true,
          location: { select: { name: true } },
          schedules: true,
        },
      },
    },
    orderBy: { scheduleDate: "asc" },
  });
}
