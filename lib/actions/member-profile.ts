"use server";

import { prisma } from "@/lib/prisma";
import { requireMember } from "@/lib/auth-guard";
import { revalidatePath } from "next/cache";
import { log as auditLog } from "@/lib/services/audit";

export type MemberProfileInput = {
  firstname: string;
  lastname: string;
  phone?: string;
  alternatePhone?: string;
  gender?: string;
  address?: string;
  occupation?: string;
  anniversaryDate?: string; // ISO yyyy-mm-dd
  govtId?: string;
  gstin?: string;
};

const PHONE_RE = /^\d{10}$/;

export async function updateMemberProfile(data: MemberProfileInput) {
  let session;
  try { session = await requireMember(); } catch { return { success: false, error: "Unauthorized" }; }

  const userId = Number(session.user.id);

  // Ownership: requireMember already binds to current member, but we re-load
  // to confirm the row still exists and we never accidentally touch another
  // user via id substitution.
  const existing = await prisma.user.findUnique({ where: { id: userId } });
  if (!existing) return { success: false, error: "Account not found" };

  if (!data.firstname?.trim() || !data.lastname?.trim()) {
    return { success: false, error: "First and last name are required" };
  }

  const phone = data.phone?.trim() || "";
  if (phone && !PHONE_RE.test(phone)) {
    return { success: false, error: "Phone must be 10 digits" };
  }
  const alt = data.alternatePhone?.trim() || "";
  if (alt && !PHONE_RE.test(alt)) {
    return { success: false, error: "Alternate phone must be 10 digits" };
  }

  let anniversary: Date | null = null;
  if (data.anniversaryDate) {
    const d = new Date(data.anniversaryDate);
    if (isNaN(d.getTime())) return { success: false, error: "Invalid anniversary date" };
    anniversary = d;
  }

  const gender = data.gender?.trim().toLowerCase() || null;
  if (gender && !["male", "female", "other"].includes(gender)) {
    return { success: false, error: "Invalid gender" };
  }

  await prisma.user.update({
    where: { id: userId },
    data: {
      firstname: data.firstname.trim(),
      lastname: data.lastname.trim(),
      phone: phone || null,
      alternatePhone: alt || null,
      gender,
      address: data.address?.trim() || null,
      occupation: data.occupation?.trim() || null,
      anniversaryDate: anniversary,
      govtId: data.govtId?.trim() || null,
      gstin: data.gstin?.trim() || null,
    },
  });

  await auditLog({
    action: "member.profile.update",
    status: "success",
    actorId: userId,
    actorType: "member",
    details: JSON.stringify({
      changed: Object.keys(data),
    }),
  });

  revalidatePath("/member/profile");
  return { success: true };
}
