"use server";

import { prisma } from "@/lib/prisma";
import { requireMember } from "@/lib/auth-guard";

export async function updateMemberProfile(data: {
  firstname: string;
  lastname: string;
  phone?: string;
}) {
  let session;
  try { session = await requireMember(); } catch { return { success: false, error: "Unauthorized" }; }

  const userId = Number(session.user.id);

  if (!data.firstname.trim() || !data.lastname.trim()) {
    return { success: false, error: "Name is required" };
  }

  if (data.phone && !/^\d{10}$/.test(data.phone)) {
    return { success: false, error: "Phone must be 10 digits" };
  }

  await prisma.user.update({
    where: { id: userId },
    data: {
      firstname: data.firstname.trim(),
      lastname: data.lastname.trim(),
      phone: data.phone?.trim() || null,
    },
  });

  return { success: true };
}
