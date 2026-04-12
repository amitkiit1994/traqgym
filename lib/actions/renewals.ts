"use server";

import { prisma } from "@/lib/prisma";
import { renewMembership } from "@/lib/services/renewal";
import { revalidatePath, revalidateTag } from "next/cache";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { requireWorker } from "@/lib/auth-guard";
import { renewalSchema, zodErrors } from "@/lib/validations";

export async function getMemberById(id: number) {
  try { await requireWorker(); } catch { return null; }
  return prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      firstname: true,
      lastname: true,
      email: true,
      phone: true,
      locationId: true,
      memberTickets: {
        orderBy: { expireDate: "desc" },
        take: 1,
        select: { planId: true },
      },
    },
  });
}

export async function searchMembers(query: string) {
  try { await requireWorker(); } catch { return []; }
  if (!query || query.length < 2) return [];

  return prisma.user.findMany({
    where: {
      OR: [
        { firstname: { contains: query, mode: "insensitive" } },
        { lastname: { contains: query, mode: "insensitive" } },
        { email: { contains: query, mode: "insensitive" } },
        { phone: { contains: query } },
      ],
    },
    select: {
      id: true,
      firstname: true,
      lastname: true,
      email: true,
      phone: true,
    },
    take: 10,
  });
}

export async function getActivePlans() {
  try { await requireWorker(); } catch { return []; }
  const plans = await prisma.ticketPlan.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
  });
  return plans.map((p) => ({
    ...p,
    price: Number(p.price),
  }));
}

export async function getActiveLocations() {
  try { await requireWorker(); } catch { return []; }
  return prisma.location.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
  });
}

export async function submitRenewal(data: {
  userId: number;
  planId: number;
  locationId: number;
  paymentMode: string;
  upiReference?: string;
  promoCode?: string;
}) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.actorType !== "worker") {
    return { error: "Unauthorized" };
  }

  const parsed = renewalSchema.safeParse(data);
  if (!parsed.success) return { error: Object.values(zodErrors(parsed.error))[0] };

  try {
    const result = await renewMembership({
      userId: data.userId,
      planId: data.planId,
      locationId: data.locationId,
      paymentMode: data.paymentMode,
      upiReference: data.upiReference,
      promoCode: data.promoCode,
      collectedById: parseInt(session.user.id, 10),
    });

    if (result.success) {
      revalidatePath("/admin/renewals");
      revalidatePath(`/admin/members/${data.userId}`);
      revalidateTag("payments", "max");
      revalidateTag("dashboard", "max");
      revalidateTag("sidebar-counts", "max");
      revalidateTag("members", "max");
    }

    return result;
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Unknown error" };
  }
}
