"use server";

import { prisma } from "@/lib/prisma";
import { requireMember } from "@/lib/auth-guard";
import { revalidatePath } from "next/cache";
import { log as auditLog } from "@/lib/services/audit";

const PHONE_RE = /^\d{10}$/;

export async function createMemberReferral(data: {
  refereeName: string;
  refereePhone: string;
  message?: string;
}) {
  let session;
  try { session = await requireMember(); } catch { return { success: false, error: "Unauthorized" }; }

  const referrerId = Number(session.user.id);
  const name = data.refereeName?.trim() || "";
  const phone = data.refereePhone?.trim() || "";

  if (!name) return { success: false, error: "Friend's name is required" };
  if (!PHONE_RE.test(phone)) return { success: false, error: "Phone must be a 10-digit number" };

  // Reject self-referral
  const me = await prisma.user.findUnique({
    where: { id: referrerId },
    select: { phone: true },
  });
  if (me?.phone === phone) {
    return { success: false, error: "You can't refer your own number" };
  }

  // Reject if already an existing member
  const existingMember = await prisma.user.findFirst({
    where: { phone },
    select: { id: true },
  });
  if (existingMember) {
    return { success: false, error: "This phone is already registered as a member" };
  }

  // Reject duplicate referral by the same referrer
  const dup = await prisma.referral.findFirst({
    where: { referrerId, referredPhone: phone },
    select: { id: true },
  });
  if (dup) {
    return { success: false, error: "You've already referred this number" };
  }

  const created = await prisma.referral.create({
    data: {
      referrerId,
      referredName: name,
      referredPhone: phone,
      status: "pending",
    },
  });

  await auditLog({
    action: "member.referral.create",
    status: "success",
    actorId: referrerId,
    actorType: "member",
    details: JSON.stringify({
      referralId: created.id,
      refereePhone: phone,
      hasMessage: Boolean(data.message?.trim()),
    }),
  });

  revalidatePath("/member/referrals");
  return { success: true };
}
