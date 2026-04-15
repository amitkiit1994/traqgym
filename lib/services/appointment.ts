import { prisma } from "@/lib/prisma";
import * as audit from "@/lib/services/audit";

export async function bookAppointment(params: {
  userId: number;
  trainerId: number;
  date: Date;
  startTime: string;
  endTime: string;
  notes?: string;
}) {
  // Validate no conflicting appointment for trainer at that slot
  const dateOnly = new Date(
    params.date.getFullYear(),
    params.date.getMonth(),
    params.date.getDate()
  );

  const conflict = await prisma.appointment.findFirst({
    where: {
      trainerId: params.trainerId,
      date: dateOnly,
      status: { notIn: ["cancelled"] },
      OR: [
        {
          startTime: { lt: params.endTime },
          endTime: { gt: params.startTime },
        },
      ],
    },
  });

  if (conflict) {
    return {
      success: false as const,
      error: `Trainer has a conflicting appointment from ${conflict.startTime} to ${conflict.endTime}`,
    };
  }

  try {
    const appointment = await prisma.appointment.create({
      data: {
        userId: params.userId,
        trainerId: params.trainerId,
        date: dateOnly,
        startTime: params.startTime,
        endTime: params.endTime,
        notes: params.notes ?? null,
        status: "booked",
      },
    });

    await audit.log({
      action: "appointment_booked",
      status: "success",
      details: `Appointment #${appointment.id} booked for user ${params.userId} with trainer ${params.trainerId} on ${dateOnly.toISOString().split("T")[0]} ${params.startTime}-${params.endTime}`,
    });

    return { success: true as const, id: appointment.id };
  } catch (err) {
    return {
      success: false as const,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

export async function cancelAppointment(appointmentId: number) {
  try {
    await prisma.appointment.update({
      where: { id: appointmentId },
      data: { status: "cancelled" },
    });

    await audit.log({
      action: "appointment_cancelled",
      status: "success",
      details: `Appointment #${appointmentId} cancelled`,
    });

    return { success: true as const };
  } catch (err) {
    return {
      success: false as const,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

export async function completeAppointment(appointmentId: number) {
  try {
    await prisma.appointment.update({
      where: { id: appointmentId },
      data: { status: "completed" },
    });

    return { success: true as const };
  } catch (err) {
    return {
      success: false as const,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

export async function getAppointments(params?: {
  userId?: number;
  trainerId?: number;
  date?: Date;
  status?: string;
}) {
  const where: Record<string, unknown> = {};
  if (params?.userId) where.userId = params.userId;
  if (params?.trainerId) where.trainerId = params.trainerId;
  if (params?.date) {
    const d = new Date(
      params.date.getFullYear(),
      params.date.getMonth(),
      params.date.getDate()
    );
    where.date = d;
  }
  if (params?.status) where.status = params.status;

  const appointments = await prisma.appointment.findMany({
    where,
    include: {
      user: { select: { id: true, firstname: true, lastname: true, phone: true } },
      trainer: { select: { id: true, firstname: true, lastname: true } },
    },
    orderBy: [{ date: "desc" }, { startTime: "asc" }],
  });

  return appointments.map((a) => ({
    id: a.id,
    date: a.date.toISOString().split("T")[0],
    startTime: a.startTime,
    endTime: a.endTime,
    status: a.status,
    notes: a.notes,
    userId: a.userId,
    userName: `${a.user.firstname} ${a.user.lastname}`,
    userPhone: a.user.phone,
    trainerId: a.trainerId,
    trainerName: `${a.trainer.firstname} ${a.trainer.lastname}`,
    createdAt: a.createdAt.toISOString(),
  }));
}

export async function getTrainerAvailability(trainerId: number, date: Date) {
  const dateOnly = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate()
  );

  const booked = await prisma.appointment.findMany({
    where: {
      trainerId,
      date: dateOnly,
      status: { notIn: ["cancelled"] },
    },
    select: { startTime: true, endTime: true, status: true },
    orderBy: { startTime: "asc" },
  });

  return booked;
}
