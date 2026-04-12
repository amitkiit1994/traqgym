"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { requireWorker } from "@/lib/auth-guard";
import { createWorkerSchema, updateWorkerSchema, zodErrors } from "@/lib/validations";

export async function getWorkers() {
  try { await requireWorker(["admin"]); } catch { return []; }
  return prisma.worker.findMany({
    include: { location: true },
    orderBy: { id: "asc" },
  });
}

export async function createWorker(data: {
  email: string;
  password: string;
  firstname: string;
  lastname: string;
  role: string;
  locationId?: number | null;
}) {
  try { await requireWorker(["admin"]); } catch { return { error: "Unauthorized" }; }
  const parsed = createWorkerSchema.safeParse(data);
  if (!parsed.success) return { errors: zodErrors(parsed.error) };

  const existing = await prisma.worker.findUnique({
    where: { email: data.email.trim() },
  });
  if (existing) return { errors: { email: "Email already exists" } };

  const hashed = await bcrypt.hash(data.password, 10);

  await prisma.worker.create({
    data: {
      email: data.email.trim(),
      password: hashed,
      firstname: data.firstname.trim(),
      lastname: data.lastname.trim(),
      role: data.role.trim(),
      locationId: data.locationId ?? null,
    },
  });
  revalidatePath("/workers");
  return { success: true };
}

export async function updateWorker(
  id: number,
  data: {
    firstname: string;
    lastname: string;
    email: string;
    role: string;
    locationId?: number | null;
    password?: string;
  }
) {
  try { await requireWorker(["admin"]); } catch { return { error: "Unauthorized" }; }
  const parsed = updateWorkerSchema.safeParse(data);
  if (!parsed.success) return { errors: zodErrors(parsed.error) };

  const existing = await prisma.worker.findFirst({
    where: { email: data.email.trim(), NOT: { id } },
  });
  if (existing) return { errors: { email: "Email already in use" } };

  const updateData: Record<string, unknown> = {
    firstname: data.firstname.trim(),
    lastname: data.lastname.trim(),
    email: data.email.trim(),
    role: data.role.trim(),
    locationId: data.locationId ?? null,
  };

  if (data.password) {
    updateData.password = await bcrypt.hash(data.password, 10);
  }

  await prisma.worker.update({
    where: { id },
    data: updateData,
  });
  revalidatePath("/workers");
  return { success: true };
}

export async function toggleWorkerActive(id: number) {
  try { await requireWorker(["admin"]); } catch { return { error: "Unauthorized" }; }
  const worker = await prisma.worker.findUnique({ where: { id } });
  if (!worker) return { errors: { _form: "Worker not found" } };

  await prisma.worker.update({
    where: { id },
    data: { isActive: !worker.isActive },
  });
  revalidatePath("/workers");
  return { success: true };
}
