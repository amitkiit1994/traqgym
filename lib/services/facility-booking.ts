import { prisma } from "@/lib/prisma";

export async function getFacilities(locationId?: number) {
  return prisma.facility.findMany({
    where: {
      isActive: true,
      ...(locationId ? { locationId } : {}),
    },
    orderBy: { name: "asc" },
  });
}

export async function getAvailableSlots(facilityId: number, date: Date) {
  const slots = await prisma.facilitySlot.findMany({
    where: {
      facilityId,
      date,
      status: { not: "blocked" },
    },
    include: {
      _count: {
        select: {
          bookings: { where: { status: "booked" } },
        },
      },
    },
    orderBy: { startTime: "asc" },
  });

  return slots.map((slot) => ({
    id: slot.id,
    facilityId: slot.facilityId,
    date: slot.date,
    startTime: slot.startTime,
    endTime: slot.endTime,
    maxCapacity: slot.maxCapacity,
    bookedCount: slot._count.bookings,
    available: slot.maxCapacity - slot._count.bookings,
    status: slot.status,
  }));
}

export async function bookSlot(params: { slotId: number; userId: number }) {
  return prisma.$transaction(async (tx) => {
    const slot = await tx.facilitySlot.findUnique({
      where: { id: params.slotId },
      include: {
        _count: {
          select: {
            bookings: { where: { status: "booked" } },
          },
        },
      },
    });

    if (!slot) {
      return { success: false as const, error: "Slot not found" };
    }
    if (slot.status === "blocked") {
      return { success: false as const, error: "Slot is blocked" };
    }
    if (slot._count.bookings >= slot.maxCapacity) {
      return { success: false as const, error: "Slot is full" };
    }

    // Check if user already has a booking for this slot
    const existing = await tx.facilityBooking.findUnique({
      where: { slotId_userId: { slotId: params.slotId, userId: params.userId } },
    });
    if (existing && existing.status === "booked") {
      return { success: false as const, error: "Already booked this slot" };
    }

    const booking = await tx.facilityBooking.create({
      data: {
        slotId: params.slotId,
        userId: params.userId,
        status: "booked",
      },
    });

    // If now at capacity, mark slot as full
    if (slot._count.bookings + 1 >= slot.maxCapacity) {
      await tx.facilitySlot.update({
        where: { id: params.slotId },
        data: { status: "full" },
      });
    }

    return { success: true as const, booking };
  });
}

export async function cancelBooking(bookingId: number) {
  return prisma.$transaction(async (tx) => {
    const booking = await tx.facilityBooking.findUnique({
      where: { id: bookingId },
      include: { slot: true },
    });

    if (!booking) {
      return { success: false as const, error: "Booking not found" };
    }
    if (booking.status === "cancelled") {
      return { success: false as const, error: "Booking already cancelled" };
    }

    await tx.facilityBooking.update({
      where: { id: bookingId },
      data: { status: "cancelled" },
    });

    // If slot was full, set back to available
    if (booking.slot.status === "full") {
      await tx.facilitySlot.update({
        where: { id: booking.slotId },
        data: { status: "available" },
      });
    }

    return { success: true as const };
  });
}

export async function getUserBookings(userId: number) {
  return prisma.facilityBooking.findMany({
    where: {
      userId,
      status: "booked",
      slot: {
        date: { gte: new Date() },
      },
    },
    include: {
      slot: {
        include: {
          facility: { select: { name: true, type: true } },
        },
      },
    },
    orderBy: { slot: { date: "asc" } },
  });
}
