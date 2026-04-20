"use server";

import { z } from "zod";
import { requireWorker } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import {
  bookAppointment,
  cancelAppointment,
  completeAppointment,
  getAppointments,
  getTrainerAvailability,
} from "@/lib/services/appointment";

const bookSchema = z.object({
  userId: z.number().int().positive(),
  trainerId: z.number().int().positive(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endTime: z.string().regex(/^\d{2}:\d{2}$/),
  notes: z.string().optional(),
});

export async function bookAppointmentAction(data: {
  userId: number;
  trainerId: number;
  date: string;
  startTime: string;
  endTime: string;
  notes?: string;
}) {
  try {
    await requireWorker();
  } catch {
    return { success: false, error: "Unauthorized" };
  }

  const parsed = bookSchema.safeParse(data);
  if (!parsed.success) {
    const firstError = Object.values(parsed.error.flatten().fieldErrors)[0]?.[0];
    return { success: false, error: firstError ?? "Invalid input" };
  }

  return bookAppointment({
    userId: data.userId,
    trainerId: data.trainerId,
    date: new Date(data.date),
    startTime: data.startTime,
    endTime: data.endTime,
    notes: data.notes,
  });
}

export async function cancelAppointmentAction(appointmentId: number) {
  try {
    await requireWorker();
  } catch {
    return { success: false, error: "Unauthorized" };
  }
  return cancelAppointment(appointmentId);
}

export async function completeAppointmentAction(appointmentId: number) {
  try {
    await requireWorker();
  } catch {
    return { success: false, error: "Unauthorized" };
  }
  return completeAppointment(appointmentId);
}

export async function getAppointmentsAction(filters?: {
  userId?: number;
  trainerId?: number;
  date?: string;
  status?: string;
}) {
  try {
    await requireWorker();
  } catch {
    return [];
  }
  return getAppointments({
    userId: filters?.userId,
    trainerId: filters?.trainerId,
    date: filters?.date ? new Date(filters.date) : undefined,
    status: filters?.status,
  });
}

export async function getTrainersAction() {
  try {
    await requireWorker();
  } catch {
    return [];
  }
  return prisma.worker.findMany({
    where: {
      isActive: true,
      OR: [
        { ptPackagesAsTrainer: { some: {} } },
        { trainerPayments: { some: {} } },
        { appointments: { some: {} } },
      ],
    },
    select: { id: true, firstname: true, lastname: true, role: true },
    orderBy: { firstname: "asc" },
  });
}

export async function searchMembersAction(query: string) {
  try {
    await requireWorker();
  } catch {
    return [];
  }
  if (!query || query.length < 2) return [];
  const q = query.trim();
  return prisma.user.findMany({
    where: {
      OR: [
        { firstname: { contains: q, mode: "insensitive" } },
        { lastname: { contains: q, mode: "insensitive" } },
        { phone: { contains: q } },
      ],
    },
    select: { id: true, firstname: true, lastname: true, phone: true },
    take: 10,
  });
}

export async function getTrainerAvailabilityAction(
  trainerId: number,
  date: string
) {
  try {
    await requireWorker();
  } catch {
    return [];
  }
  return getTrainerAvailability(trainerId, new Date(date));
}
