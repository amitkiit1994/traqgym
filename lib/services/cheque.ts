import { prisma } from "@/lib/prisma";

export async function updateChequeStatus(
  paymentId: number,
  status: "cleared" | "bounced",
  notes?: string
) {
  try {
    const payment = await prisma.payment.findUnique({
      where: { id: paymentId },
      select: { id: true, chequeStatus: true, userId: true, memberTicketId: true, amount: true },
    });

    if (!payment) {
      return { success: false as const, error: "Payment not found" };
    }

    if (payment.chequeStatus !== "pending") {
      return { success: false as const, error: `Cheque is already ${payment.chequeStatus}` };
    }

    const updated = await prisma.payment.update({
      where: { id: paymentId },
      data: { chequeStatus: status },
    });

    // If bounced, auto-create a PaymentFollowup
    if (status === "bounced") {
      await prisma.paymentFollowup.create({
        data: {
          userId: payment.userId,
          memberTicketId: payment.memberTicketId,
          amountDue: Number(payment.amount),
          dueDate: new Date(),
          status: "pending",
          priority: "high",
          notes: notes
            ? `Cheque bounced (Payment #${paymentId}): ${notes}`
            : `Cheque bounced (Payment #${paymentId})`,
        },
      });

      // In-app notification for admins (fire-and-forget)
      try {
        const { notifyWorkersByRole } = await import("@/lib/services/in-app-notification");
        await notifyWorkersByRole({
          role: "admin",
          type: "cheque_bounced",
          title: `Cheque bounced — Payment #${paymentId}`,
          message: `Amount: ₹${Number(payment.amount).toLocaleString("en-IN")}`,
          link: "/admin/followups",
        });
      } catch {}
    }

    return { success: true as const, payment: updated };
  } catch (err) {
    console.error("[Cheque] updateChequeStatus error:", err);
    return { success: false as const, error: "Failed to update cheque status" };
  }
}

export async function getPendingCheques(locationId?: number) {
  try {
    const where: Record<string, unknown> = { chequeStatus: "pending" };
    if (locationId) where.locationId = locationId;

    const cheques = await prisma.payment.findMany({
      where,
      include: {
        user: { select: { id: true, firstname: true, lastname: true, phone: true } },
      },
      orderBy: { chequeDate: "asc" },
    });

    return cheques.map((c) => ({
      paymentId: c.id,
      memberName: `${c.user.firstname} ${c.user.lastname}`,
      memberId: c.user.id,
      phone: c.user.phone || "-",
      amount: Number(c.amount),
      chequeNumber: c.chequeNumber,
      chequeDate: c.chequeDate?.toISOString() ?? null,
      bankName: c.bankName,
      createdAt: c.createdAt.toISOString(),
    }));
  } catch (err) {
    console.error("[Cheque] getPendingCheques error:", err);
    return [];
  }
}

export async function getBouncedCheques(locationId?: number) {
  try {
    const where: Record<string, unknown> = { chequeStatus: "bounced" };
    if (locationId) where.locationId = locationId;

    const cheques = await prisma.payment.findMany({
      where,
      include: {
        user: { select: { id: true, firstname: true, lastname: true, phone: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    return cheques.map((c) => ({
      paymentId: c.id,
      memberName: `${c.user.firstname} ${c.user.lastname}`,
      memberId: c.user.id,
      phone: c.user.phone || "-",
      amount: Number(c.amount),
      chequeNumber: c.chequeNumber,
      chequeDate: c.chequeDate?.toISOString() ?? null,
      bankName: c.bankName,
      createdAt: c.createdAt.toISOString(),
    }));
  } catch (err) {
    console.error("[Cheque] getBouncedCheques error:", err);
    return [];
  }
}
