"use server";

import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export async function getMemberPayments(
  userId: number,
  params?: { page?: number; pageSize?: number }
) {
  const session = await getServerSession(authOptions);
  if (!session) return { payments: [], total: 0 };
  // Members can only view their own payments
  if (session.user.actorType === "member") {
    const sessionUserId = parseInt(session.user.id);
    if (sessionUserId !== userId) return { payments: [], total: 0 };
  } else if (session.user.actorType !== "worker") {
    return { payments: [], total: 0 };
  }

  const page = params?.page ?? 1;
  const pageSize = params?.pageSize ?? 25;
  const skip = (page - 1) * pageSize;

  const where = { userId, memberTicketId: { not: null } };

  const [rows, total] = await Promise.all([
    prisma.payment.findMany({
      where,
      include: {
        memberTicket: {
          include: { plan: { select: { name: true } } },
        },
        collectedBy: {
          select: { firstname: true, lastname: true },
        },
        invoice: {
          select: { id: true, invoiceNumber: true },
        },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take: pageSize,
    }),
    prisma.payment.count({ where }),
  ]);

  const payments = rows.map((p) => ({
    id: p.id,
    date: p.createdAt.toISOString(),
    planName: p.memberTicket?.plan.name ?? "—",
    amount: Number(p.amount),
    paymentMode: p.paymentMode,
    upiReference: p.upiReference,
    invoiceId: p.invoice?.id ?? null,
    invoiceNumber: p.invoice?.invoiceNumber ?? null,
    collectedBy: `${p.collectedBy.firstname} ${p.collectedBy.lastname}`,
  }));

  return { payments, total };
}
