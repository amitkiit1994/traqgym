"use server";

import {
  freezeMembership,
  cancelFreeze,
  getActiveFreezes,
} from "@/lib/services/freeze";
import { prisma } from "@/lib/prisma";
import { revalidatePath, revalidateTag } from "next/cache";
import { requireWorker } from "@/lib/auth-guard";
import { freezeSchema, zodErrors } from "@/lib/validations";

export async function freezeMembershipAction(
  userId: number,
  memberTicketId: number,
  freezeStart: string,
  freezeEnd: string,
  reason?: string
) {
  try { await requireWorker(); } catch { return { error: "Unauthorized" }; }
  const parsed = freezeSchema.safeParse({ userId, memberTicketId, freezeStart, freezeEnd, reason });
  if (!parsed.success) return { error: Object.values(zodErrors(parsed.error))[0] };
  const result = await freezeMembership(
    userId,
    memberTicketId,
    new Date(freezeStart),
    new Date(freezeEnd),
    reason
  );
  if (result.success) {
    await prisma.auditLog.create({
      data: {
        action: "membership_frozen",
        status: "success",
        details: JSON.stringify({ userId, memberTicketId, freezeStart, freezeEnd }),
        actorType: "worker",
      },
    });
    revalidatePath(`/admin/members/${userId}`);
    revalidateTag("members", "max");
    revalidateTag("dashboard", "max");
    revalidateTag("sidebar-counts", "max");
  }
  return result;
}

export async function cancelFreezeAction(freezeId: number, userId: number) {
  try { await requireWorker(); } catch { return { error: "Unauthorized" }; }
  const result = await cancelFreeze(freezeId);
  if (result.success) {
    await prisma.auditLog.create({
      data: {
        action: "freeze_cancelled",
        status: "success",
        details: JSON.stringify({ freezeId, userId }),
        actorType: "worker",
      },
    });
    revalidatePath(`/admin/members/${userId}`);
    revalidateTag("members", "max");
    revalidateTag("dashboard", "max");
    revalidateTag("sidebar-counts", "max");
  }
  return result;
}

export async function getActiveFreezesAction(userId?: number) {
  try { await requireWorker(); } catch { return []; }
  const freezes = await getActiveFreezes(userId);
  return freezes.map((f) => ({
    id: f.id,
    userId: f.userId,
    memberTicketId: f.memberTicketId,
    freezeStart: f.freezeStart.toISOString(),
    freezeEnd: f.freezeEnd.toISOString(),
    reason: f.reason,
    status: f.status,
    daysAdded: f.daysAdded,
    userName: `${f.user.firstname} ${f.user.lastname}`,
    planName: f.memberTicket.plan.name,
  }));
}
