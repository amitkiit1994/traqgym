"use server";

import { prisma } from "@/lib/prisma";
import { requireMember } from "@/lib/auth-guard";
import { revalidatePath } from "next/cache";

export async function getMyBookings() {
  const session = await requireMember();
  const userId = parseInt(session.user.id);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const bookings = await prisma.facilityBooking.findMany({
    where: {
      userId,
      status: { not: "cancelled" },
      slot: { date: { gte: today } },
    },
    include: {
      slot: {
        include: { facility: { select: { name: true, type: true } } },
      },
    },
    orderBy: { slot: { date: "asc" } },
  });

  return bookings.map((b) => ({
    id: b.id,
    facilityName: b.slot.facility.name,
    facilityType: b.slot.facility.type,
    date: b.slot.date.toISOString(),
    startTime: b.slot.startTime,
    endTime: b.slot.endTime,
    status: b.status,
  }));
}

export async function getAvailableFacilities() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 2); // today and tomorrow

  const facilities = await prisma.facility.findMany({
    where: { isActive: true },
    include: {
      slots: {
        where: {
          date: { gte: today, lt: tomorrow },
          status: "available",
        },
        include: {
          _count: { select: { bookings: { where: { status: "booked" } } } },
        },
        orderBy: [{ date: "asc" }, { startTime: "asc" }],
      },
    },
    orderBy: { name: "asc" },
  });

  return facilities.map((f) => ({
    id: f.id,
    name: f.name,
    type: f.type,
    slots: f.slots
      .filter((s) => s._count.bookings < s.maxCapacity)
      .map((s) => ({
        id: s.id,
        date: s.date.toISOString(),
        startTime: s.startTime,
        endTime: s.endTime,
        spotsLeft: s.maxCapacity - s._count.bookings,
      })),
  }));
}

export async function bookFacilitySlot(slotId: number) {
  const session = await requireMember();
  const userId = parseInt(session.user.id);

  const slot = await prisma.facilitySlot.findUnique({
    where: { id: slotId },
    include: { _count: { select: { bookings: { where: { status: "booked" } } } } },
  });

  if (!slot || slot.status !== "available") {
    return { success: false, error: "Slot not available" };
  }

  if (slot._count.bookings >= slot.maxCapacity) {
    return { success: false, error: "Slot is full" };
  }

  const existing = await prisma.facilityBooking.findUnique({
    where: { slotId_userId: { slotId, userId } },
  });
  if (existing && existing.status === "booked") {
    return { success: false, error: "Already booked" };
  }

  if (existing) {
    await prisma.facilityBooking.update({
      where: { id: existing.id },
      data: { status: "booked" },
    });
  } else {
    await prisma.facilityBooking.create({
      data: { slotId, userId },
    });
  }

  revalidatePath("/member/bookings");
  return { success: true };
}

export async function cancelMyBooking(bookingId: number) {
  const session = await requireMember();
  const userId = parseInt(session.user.id);

  const booking = await prisma.facilityBooking.findUnique({
    where: { id: bookingId },
  });

  if (!booking || booking.userId !== userId) {
    return { success: false, error: "Booking not found" };
  }

  if (booking.status !== "booked") {
    return { success: false, error: "Cannot cancel this booking" };
  }

  await prisma.facilityBooking.update({
    where: { id: bookingId },
    data: { status: "cancelled" },
  });

  revalidatePath("/member/bookings");
  return { success: true };
}
