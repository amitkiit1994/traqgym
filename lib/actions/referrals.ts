"use server";

import { prisma } from "@/lib/prisma";
import { requireWorker } from "@/lib/auth-guard";
import { referralSchema, zodErrors } from "@/lib/validations";

export async function getReferralsByUser(userId: number) {
  try { await requireWorker(); } catch { return []; }
  const rows = await prisma.referral.findMany({
    where: { referrerId: userId },
    include: {
      referred: { select: { firstname: true, lastname: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return rows.map((r) => ({
    id: r.id,
    referredName: r.referredName,
    referredPhone: r.referredPhone,
    status: r.status,
    rewardGiven: r.rewardGiven,
    referredMemberName: r.referred
      ? `${r.referred.firstname} ${r.referred.lastname}`
      : null,
    createdAt: r.createdAt.toISOString(),
  }));
}

export async function getReferralCount(userId: number) {
  try { await requireWorker(); } catch { return 0; }
  return prisma.referral.count({ where: { referrerId: userId } });
}

export async function createReferral(data: {
  referrerId: number;
  referredName: string;
  referredPhone: string;
}) {
  try { await requireWorker(); } catch { return { error: "Unauthorized" }; }
  const parsed = referralSchema.safeParse(data);
  if (!parsed.success) return { error: Object.values(zodErrors(parsed.error))[0] };

  await prisma.referral.create({
    data: {
      referrerId: data.referrerId,
      referredName: data.referredName.trim(),
      referredPhone: data.referredPhone.trim(),
    },
  });
  return { success: true };
}
