import { prisma } from "@/lib/prisma";

export async function updateChequeStatus(
  paymentId: number,
  status: "cleared" | "bounced",
  notes?: string
) {
  try {
    const result = await prisma.$transaction(async (tx) => {
      // Re-read inside the txn so the not-already-bounced check is based on a
      // consistent snapshot. Two concurrent calls cannot both pass this check.
      const payment = await tx.payment.findUnique({
        where: { id: paymentId },
        select: { id: true, chequeStatus: true, userId: true, memberTicketId: true, amount: true },
      });

      if (!payment) {
        return { success: false as const, error: "Payment not found" };
      }

      if (payment.chequeStatus !== "pending") {
        return { success: false as const, error: `Cheque is already ${payment.chequeStatus}` };
      }

      const updated = await tx.payment.update({
        where: { id: paymentId },
        data: { chequeStatus: status },
      });

      // If bounced, auto-create a PaymentFollowup atomically with the status flip
      // so a second concurrent call cannot double-insert a follow-up / penalty.
      if (status === "bounced") {
        await tx.paymentFollowup.create({
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
      }

      await tx.auditLog.create({
        data: {
          action: status === "bounced" ? "cheque_bounced" : "cheque_cleared",
          status: "success",
          details: JSON.stringify({
            paymentId,
            userId: payment.userId,
            memberTicketId: payment.memberTicketId,
            amount: Number(payment.amount),
            previousStatus: "pending",
            newStatus: status,
            notes: notes ?? null,
          }),
          actorType: "worker",
        },
      });

      return { success: true as const, payment: updated, notify: status === "bounced", amount: Number(payment.amount) };
    });

    if (!result.success) {
      return result;
    }

    // In-app notification for admins (fire-and-forget) — outside the txn to
    // avoid holding a DB connection on a network/import call.
    if (result.notify) {
      try {
        const { notifyWorkersByRole } = await import("@/lib/services/in-app-notification");
        await notifyWorkersByRole({
          role: "admin",
          type: "cheque_bounced",
          title: `Cheque bounced — Payment #${paymentId}`,
          message: `Amount: ₹${result.amount.toLocaleString("en-IN")}`,
          link: "/admin/followups",
        });
      } catch {}
    }

    return { success: true as const, payment: result.payment };
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
