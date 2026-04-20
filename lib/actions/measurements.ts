"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { measurementSchema, zodErrors } from "@/lib/validations";

export async function getMeasurements(userId: number) {
  const session = await getServerSession(authOptions);
  if (!session) return [];
  // Members can only view their own measurements
  if (session.user.actorType === "member") {
    const sessionUserId = parseInt(session.user.id);
    if (sessionUserId !== userId) return [];
  } else if (session.user.actorType !== "worker") {
    return [];
  }
  const measurements = await prisma.bodyMeasurement.findMany({
    where: { userId },
    orderBy: { date: "desc" },
  });

  return measurements.map((m) => ({
    id: m.id,
    date: m.date.toISOString(),
    weight: m.weight ? Number(m.weight) : null,
    height: m.height ? Number(m.height) : null,
    bmi: m.bmi ? Number(m.bmi) : null,
    chest: m.chest ? Number(m.chest) : null,
    waist: m.waist ? Number(m.waist) : null,
    hips: m.hips ? Number(m.hips) : null,
    biceps: m.biceps ? Number(m.biceps) : null,
    notes: m.notes,
  }));
}

export async function addMeasurement(
  userId: number,
  data: {
    date: string;
    weight?: number;
    height?: number;
    chest?: number;
    waist?: number;
    hips?: number;
    biceps?: number;
    notes?: string;
    recordedBy?: number;
  }
) {
  const session = await getServerSession(authOptions);
  if (!session) return { error: "Unauthorized" };
  // Members can only add their own measurements
  let recordedById: number | null = null;
  if (session.user.actorType === "member") {
    const sessionUserId = parseInt(session.user.id);
    if (sessionUserId !== userId) return { error: "Unauthorized" };
    // Member self-recorded: recordedBy stays null (members are not workers)
  } else if (session.user.actorType === "worker") {
    // Worker branch: ALWAYS override any client-supplied recordedBy with the
    // authenticated worker's id. A malicious client could otherwise attribute
    // measurements to another worker.
    const workerId = parseInt(session.user.id);
    recordedById = Number.isFinite(workerId) ? workerId : null;
  } else {
    return { error: "Unauthorized" };
  }
  const parsed = measurementSchema.safeParse(data);
  if (!parsed.success) return { error: Object.values(zodErrors(parsed.error))[0] };
  // Auto-calculate BMI if weight and height provided
  let bmi: number | undefined;
  if (data.weight && data.height) {
    const heightM = data.height / 100;
    bmi = parseFloat((data.weight / (heightM * heightM)).toFixed(2));
  }

  await prisma.bodyMeasurement.create({
    data: {
      userId,
      date: new Date(data.date),
      weight: data.weight ?? null,
      height: data.height ?? null,
      bmi: bmi ?? null,
      chest: data.chest ?? null,
      waist: data.waist ?? null,
      hips: data.hips ?? null,
      biceps: data.biceps ?? null,
      notes: data.notes ?? null,
      recordedBy: recordedById,
    },
  });

  revalidatePath(`/admin/members/${userId}`);
  revalidatePath("/member/measurements");
  return { success: true };
}
