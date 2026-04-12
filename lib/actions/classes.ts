"use server";

import { revalidatePath } from "next/cache";
import { requireWorker, requireMember } from "@/lib/auth-guard";
import { classSchema, zodErrors } from "@/lib/validations";
import {
  createClass,
  updateClass,
  toggleClassActive,
  getClasses,
  getClassById,
  bookClass,
  cancelBooking,
  getUpcomingClasses,
  getMemberBookings,
  getClassBookings,
} from "@/lib/services/class";

export async function getClassesAction(locationId?: number) {
  try {
    await requireWorker();
  } catch {
    return [];
  }
  const classes = await getClasses(locationId);
  return classes.map((c) => ({
    id: c.id,
    name: c.name,
    description: c.description,
    classType: c.classType,
    instructorId: c.instructorId,
    instructorName: c.instructor
      ? `${c.instructor.firstname} ${c.instructor.lastname}`
      : null,
    locationId: c.locationId,
    locationName: c.location.name,
    maxCapacity: c.maxCapacity,
    isActive: c.isActive,
    schedules: c.schedules.map((s) => ({
      id: s.id,
      dayOfWeek: s.dayOfWeek,
      startTime: s.startTime,
      endTime: s.endTime,
    })),
    bookingCount: c._count.bookings,
  }));
}

export async function createClassAction(data: {
  name: string;
  description?: string;
  classType?: string;
  instructorId?: number;
  locationId: number;
  maxCapacity: number;
  schedules: { dayOfWeek: number; startTime: string; endTime: string }[];
}) {
  try {
    await requireWorker();
  } catch {
    return { error: "Unauthorized" };
  }
  const parsed = classSchema.safeParse(data);
  if (!parsed.success) return { error: Object.values(zodErrors(parsed.error))[0] };
  const result = await createClass(data);
  if (result.success) {
    revalidatePath("/admin/classes");
  }
  return result;
}

export async function updateClassAction(
  id: number,
  data: {
    name: string;
    description?: string;
    classType?: string;
    instructorId?: number | null;
    locationId: number;
    maxCapacity: number;
    schedules: { dayOfWeek: number; startTime: string; endTime: string }[];
  }
) {
  try {
    await requireWorker();
  } catch {
    return { error: "Unauthorized" };
  }
  const parsed = classSchema.safeParse(data);
  if (!parsed.success) return { error: Object.values(zodErrors(parsed.error))[0] };
  const result = await updateClass(id, data);
  if (result.success) {
    revalidatePath("/admin/classes");
  }
  return result;
}

export async function toggleClassActiveAction(id: number) {
  try {
    await requireWorker();
  } catch {
    return { error: "Unauthorized" };
  }
  const result = await toggleClassActive(id);
  if (result.success) {
    revalidatePath("/admin/classes");
  }
  return result;
}

export async function getClassByIdAction(id: number) {
  try {
    await requireWorker();
  } catch {
    return null;
  }
  return getClassById(id);
}

export async function getClassBookingsAction(classId: number, dateStr: string) {
  try {
    await requireWorker();
  } catch {
    return [];
  }
  const date = new Date(dateStr);
  date.setHours(0, 0, 0, 0);
  const bookings = await getClassBookings(classId, date);
  return bookings.map((b) => ({
    id: b.id,
    userId: b.userId,
    userName: `${b.user.firstname} ${b.user.lastname}`,
    phone: b.user.phone,
    status: b.status,
    scheduleDate: b.scheduleDate.toISOString(),
  }));
}

export async function bookClassAction(classId: number, scheduleDateStr: string) {
  let session;
  try {
    session = await requireMember();
  } catch {
    return { success: false, error: "Unauthorized" };
  }
  const scheduleDate = new Date(scheduleDateStr);
  scheduleDate.setHours(0, 0, 0, 0);
  const result = await bookClass({
    classId,
    userId: Number(session.user.id),
    scheduleDate,
  });
  if (result.success) {
    revalidatePath("/member/classes");
  }
  return result;
}

export async function cancelBookingAction(bookingId: number) {
  let session;
  try {
    session = await requireMember();
  } catch {
    return { success: false, error: "Unauthorized" };
  }
  const result = await cancelBooking(bookingId, Number(session.user.id));
  if (result.success) {
    revalidatePath("/member/classes");
  }
  return result;
}

export async function getUpcomingClassesAction(locationId?: number) {
  return getUpcomingClasses(locationId);
}

export async function getMemberBookingsAction() {
  let session;
  try {
    session = await requireMember();
  } catch {
    return [];
  }
  const bookings = await getMemberBookings(Number(session.user.id));
  return bookings.map((b) => ({
    id: b.id,
    classId: b.classId,
    className: b.gymClass.name,
    classType: b.gymClass.classType,
    locationName: b.gymClass.location.name,
    scheduleDate: b.scheduleDate.toISOString(),
    status: b.status,
  }));
}
