"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { requireWorker } from "@/lib/auth-guard";
import { locationSchema, openingHoursSchema, zodErrors } from "@/lib/validations";

export async function getLocations() {
  try { await requireWorker(); } catch { return []; }
  return prisma.location.findMany({
    orderBy: { id: "asc" },
  });
}

export async function createLocation(data: {
  name: string;
  code: string;
  address?: string;
  phone?: string;
}) {
  try { await requireWorker(["admin"]); } catch { return { error: "Unauthorized" }; }
  const parsed = locationSchema.safeParse(data);
  if (!parsed.success) return { errors: zodErrors(parsed.error) };

  const existing = await prisma.location.findUnique({
    where: { code: data.code.trim() },
  });
  if (existing) return { errors: { code: "Code already exists" } };

  await prisma.location.create({
    data: {
      name: data.name.trim(),
      code: data.code.trim(),
      address: data.address?.trim() || null,
      phone: data.phone?.trim() || null,
    },
  });
  revalidatePath("/locations");
  return { success: true };
}

export async function updateLocation(
  id: number,
  data: {
    name: string;
    code: string;
    address?: string;
    phone?: string;
  }
) {
  try { await requireWorker(["admin"]); } catch { return { error: "Unauthorized" }; }
  const parsed = locationSchema.safeParse(data);
  if (!parsed.success) return { errors: zodErrors(parsed.error) };

  const existing = await prisma.location.findFirst({
    where: { code: data.code.trim(), NOT: { id } },
  });
  if (existing) return { errors: { code: "Code already exists" } };

  await prisma.location.update({
    where: { id },
    data: {
      name: data.name.trim(),
      code: data.code.trim(),
      address: data.address?.trim() || null,
      phone: data.phone?.trim() || null,
    },
  });
  revalidatePath("/locations");
  return { success: true };
}

export async function getOpeningHours(locationId: number) {
  try { await requireWorker(["admin"]); } catch { return []; }
  return prisma.openingHour.findMany({
    where: { locationId },
    orderBy: { dayOfWeek: "asc" },
  });
}

export async function updateOpeningHours(
  locationId: number,
  hours: Array<{ dayOfWeek: number; openTime: string; closeTime: string; isClosed: boolean }>
) {
  try { await requireWorker(["admin"]); } catch { return { error: "Unauthorized" }; }
  const parsed = openingHoursSchema.safeParse(hours);
  if (!parsed.success) return { error: Object.values(zodErrors(parsed.error))[0] };

  await prisma.$transaction(async (tx) => {
    await tx.openingHour.deleteMany({ where: { locationId } });
    await tx.openingHour.createMany({
      data: hours.map((h) => ({
        locationId,
        dayOfWeek: h.dayOfWeek,
        openTime: h.openTime,
        closeTime: h.closeTime,
        isClosed: h.isClosed,
      })),
    });
  });

  revalidatePath("/admin/locations");
  return { success: true };
}

export async function toggleLocationActive(id: number) {
  try { await requireWorker(["admin"]); } catch { return { error: "Unauthorized" }; }
  const location = await prisma.location.findUnique({ where: { id } });
  if (!location) return { errors: { _form: "Location not found" } };

  await prisma.location.update({
    where: { id },
    data: { isActive: !location.isActive },
  });
  revalidatePath("/locations");
  return { success: true };
}
