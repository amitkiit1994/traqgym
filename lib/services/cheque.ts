import { prisma } from "@/lib/prisma";

export async function updateChequeStatus(
  paymentId: number,
  status: "cleared" | "bounced",
  notes?: string
) {
  try {
    const result = await prisma.$transaction(async (tx) => {
      // Re-read inside the txn for the followup-creation context (we need
      // userId/amount/memberTicketId), but the actual status flip uses an
      // atomic compare-and-swap below so two concurrent calls cannot both
      // observe "pending" and both flip the row.
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

      // Atomic conditional update — only flips if chequeStatus is still
      // "pending" at write time. Database enforces the invariant; the second
      // concurrent caller's updateMany returns count===0 and we abort cleanly.
      const flipped = await tx.payment.updateMany({
        where: { id: paymentId, chequeStatus: "pending" },
        data: { chequeStatus: status },
      });
      if (flipped.count === 0) {
        return { success: false as const, error: "Cheque was updated concurrently — please refresh" };
      }
      const updated = await tx.payment.findUnique({ where: { id: paymentId } });

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
