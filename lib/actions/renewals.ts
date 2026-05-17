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

  // Tokenise on whitespace so "zuber qureshi" matches firstname="zuber"
  // AND lastname="qureshi", not just `firstname contains "zuber qureshi"`.
  const tokens = query.trim().split(/\s+/).filter((t) => t.length > 0);
  if (tokens.length === 0) return [];

  const select = {
    id: true,
    firstname: true,
    lastname: true,
    email: true,
    phone: true,
  } as const;

  // Single-token: keep original OR-across-fields semantics so phone-number
  // and email lookups still work.
  if (tokens.length === 1) {
    const q = tokens[0]!;
    return prisma.user.findMany({
      where: {
        OR: [
          { firstname: { contains: q, mode: "insensitive" } },
          { lastname: { contains: q, mode: "insensitive" } },
          { email: { contains: q, mode: "insensitive" } },
          { phone: { contains: q } },
        ],
      },
      select,
      take: 10,
    });
  }

  // Multi-token: AND across tokens; each token must hit at least one of
  // firstname / lastname / email.
  return prisma.user.findMany({
    where: {
      AND: tokens.map((token) => ({
        OR: [
          { firstname: { contains: token, mode: "insensitive" as const } },
          { lastname: { contains: token, mode: "insensitive" as const } },
          { email: { contains: token, mode: "insensitive" as const } },
        ],
      })),
    },
    select,
    take: 10,
  });
}

export async function getActivePlans() {
  try { await requireWorker(); } catch { return []; }
  // Sort by createdAt desc so when we dedupe by name we keep the most-recent
  // plan row (older agents/seeds occasionally created duplicate rows with the
  // same name+price; the renewal dropdown previously showed e.g. 22 identical
  // "Boundary30" entries). Final return is sorted by name for the picker.
  const plans = await prisma.ticketPlan.findMany({
    where: { isActive: true },
    orderBy: { createdAt: "desc" },
  });
  const seen = new Set<string>();
  const deduped = plans.filter((p) => {
    const key = p.name.trim().toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  deduped.sort((a, b) => a.name.localeCompare(b.name));
  return deduped.map((p) => ({
    ...p,
    price: Number(p.price),
    joiningFee: Number(p.joiningFee ?? 0),
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
  // H3 partial pay: amount actually collected. Omit/null = full payment.
  amountPaid?: number;
}) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.actorType !== "worker") {
    return { error: "Unauthorized" };
  }

  // The renewal zod schema doesn't currently know about amountPaid (validations
  // are owned by another agent's surface). Validate the optional field locally
  // before forwarding.
  const parsed = renewalSchema.safeParse({
    userId: data.userId,
    planId: data.planId,
    locationId: data.locationId,
    paymentMode: data.paymentMode,
    upiReference: data.upiReference,
    promoCode: data.promoCode,
  });
  if (!parsed.success) return { error: Object.values(zodErrors(parsed.error))[0] };

  if (
    typeof data.amountPaid === "number" &&
    (!Number.isFinite(data.amountPaid) || data.amountPaid < 0)
  ) {
    return { error: "Amount paid must be a non-negative number" };
  }

  try {
    const result = await renewMembership({
      userId: data.userId,
      planId: data.planId,
      locationId: data.locationId,
      paymentMode: data.paymentMode,
      upiReference: data.upiReference,
      promoCode: data.promoCode,
      amountPaid: data.amountPaid,
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
