"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { requireWorker } from "@/lib/auth-guard";
import { equipmentSchema, zodErrors } from "@/lib/validations";

export async function getEquipment(locationId?: number, category?: string, condition?: string) {
  try { await requireWorker(); } catch { return []; }
  const where: Record<string, unknown> = {};

  if (locationId) where.locationId = locationId;
  if (category) where.category = category;
  if (condition) where.condition = condition;

  const items = await prisma.equipment.findMany({
    where,
    include: { location: { select: { name: true } } },
    orderBy: { name: "asc" },
  });

  const now = new Date();

  return items.map((e) => ({
    id: e.id,
    name: e.name,
    category: e.category,
    locationId: e.locationId,
    locationName: e.location.name,
    purchaseDate: e.purchaseDate?.toISOString() ?? null,
    purchasePrice: e.purchasePrice ? Number(e.purchasePrice) : null,
    condition: e.condition,
    lastServiceDate: e.lastServiceDate?.toISOString() ?? null,
    nextServiceDate: e.nextServiceDate?.toISOString() ?? null,
    needsService: e.nextServiceDate ? e.nextServiceDate <= now : false,
    notes: e.notes,
    isActive: e.isActive,
    createdAt: e.createdAt.toISOString(),
  }));
}

export async function createEquipment(data: {
  name: string;
  category: string;
  locationId: number;
  purchaseDate?: string;
  purchasePrice?: number;
  condition?: string;
  lastServiceDate?: string;
  nextServiceDate?: string;
  notes?: string;
}) {
  try { await requireWorker(); } catch { return { error: "Unauthorized" }; }
  const parsed = equipmentSchema.safeParse(data);
  if (!parsed.success) return { errors: zodErrors(parsed.error) };

  await prisma.equipment.create({
    data: {
      name: data.name.trim(),
      category: data.category,
      locationId: data.locationId,
      purchaseDate: data.purchaseDate ? new Date(data.purchaseDate) : null,
      purchasePrice: data.purchasePrice ?? null,
      condition: data.condition || "good",
      lastServiceDate: data.lastServiceDate ? new Date(data.lastServiceDate) : null,
      nextServiceDate: data.nextServiceDate ? new Date(data.nextServiceDate) : null,
      notes: data.notes?.trim() || null,
    },
  });

  revalidatePath("/admin/equipment");
  return { success: true };
}

export async function updateEquipment(
  id: number,
  data: {
    name: string;
    category: string;
    locationId: number;
    purchaseDate?: string;
    purchasePrice?: number;
    condition?: string;
    lastServiceDate?: string;
    nextServiceDate?: string;
    notes?: string;
  }
) {
  try { await requireWorker(); } catch { return { error: "Unauthorized" }; }
  const parsed = equipmentSchema.safeParse(data);
  if (!parsed.success) return { errors: zodErrors(parsed.error) };

  await prisma.equipment.update({
    where: { id },
    data: {
      name: data.name.trim(),
      category: data.category,
      locationId: data.locationId,
      purchaseDate: data.purchaseDate ? new Date(data.purchaseDate) : null,
      purchasePrice: data.purchasePrice ?? null,
      condition: data.condition || "good",
      lastServiceDate: data.lastServiceDate ? new Date(data.lastServiceDate) : null,
      nextServiceDate: data.nextServiceDate ? new Date(data.nextServiceDate) : null,
      notes: data.notes?.trim() || null,
    },
  });

  revalidatePath("/admin/equipment");
  return { success: true };
}
