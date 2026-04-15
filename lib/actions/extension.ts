"use server";

import { extendMembership, getExtensions } from "@/lib/services/extension";
import { revalidatePath, revalidateTag } from "next/cache";
import { requireWorker } from "@/lib/auth-guard";
import { z } from "zod";

const extensionSchema = z.object({
  userId: z.number().int().positive(),
  memberTicketId: z.number().int().positive(),
  daysToAdd: z.number().int().positive(),
  reason: z.string().trim().min(1, "Reason is required"),
});

export async function extendMembershipAction(data: {
  userId: number;
  memberTicketId: number;
  daysToAdd: number;
  reason: string;
}) {
  let session;
  try { session = await requireWorker(["admin"]); } catch { return { success: false, error: "Unauthorized" }; }

  const parsed = extensionSchema.safeParse(data);
  if (!parsed.success) {
    const firstError = Object.values(parsed.error.flatten().fieldErrors)[0]?.[0] || "Validation error";
    return { success: false, error: firstError };
  }

  const result = await extendMembership({
    ...parsed.data,
    createdById: parseInt(session.user.id, 10),
  });

  if (result.success) {
    revalidatePath(`/admin/members/${data.userId}`);
    revalidateTag("members", "max");
    revalidateTag("dashboard", "max");
    revalidateTag("sidebar-counts", "max");
  }

  return result;
}

export async function getExtensionsAction(userId?: number) {
  try { await requireWorker(); } catch { return []; }

  const extensions = await getExtensions(userId);
  return extensions.map((e) => ({
    id: e.id,
    userId: e.userId,
    memberTicketId: e.memberTicketId,
    daysAdded: e.daysAdded,
    reason: e.reason,
    originalExpiry: e.originalExpiry.toISOString(),
    newExpiry: e.newExpiry.toISOString(),
    createdAt: e.createdAt.toISOString(),
    userName: `${e.user.firstname} ${e.user.lastname}`,
    planName: e.memberTicket.plan.name,
  }));
}
