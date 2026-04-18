import { prisma } from "@/lib/prisma";

const DAY_MS = 24 * 60 * 60 * 1000;

export async function transferMember({
  userId,
  toLocationId,
  ticketId,
  transferredBy,
  carryOverDays = false,
}: {
  userId: number;
  toLocationId: number;
  ticketId: number;
  transferredBy: number;
  carryOverDays?: boolean;
}) {
  try {
    // Validate user exists
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return { success: false as const, error: "Member not found" };

    // Validate ticket exists & is active
    const ticket = await prisma.memberTicket.findUnique({ where: { id: ticketId } });
    if (!ticket) return { success: false as const, error: "Ticket not found" };
    if (ticket.userId !== userId) return { success: false as const, error: "Ticket does not belong to this member" };
    if (ticket.status === "cancelled") return { success: false as const, error: "Ticket is cancelled" };
    if (new Date(ticket.expireDate) < new Date()) return { success: false as const, error: "Ticket is expired" };

    // Validate destination location exists & is active
    const toLocation = await prisma.location.findUnique({ where: { id: toLocationId } });
    if (!toLocation) return { success: false as const, error: "Destination location not found" };
    if (!toLocation.isActive) return { success: false as const, error: "Destination location is not active" };

    // Validate source location exists & is active (if user has one)
    if (user.locationId) {
      if (user.locationId === toLocationId) {
        return { success: false as const, error: "Member is already at this location" };
      }
      const fromLocation = await prisma.location.findUnique({ where: { id: user.locationId } });
      if (fromLocation && !fromLocation.isActive) {
        return { success: false as const, error: "Source location is not active" };
      }
    }

    const fromLocationId = user.locationId;

    // Compute carry-over days from existing ticket if requested
    const now = new Date();
    const daysRemaining = carryOverDays
      ? Math.max(0, Math.ceil((new Date(ticket.expireDate).getTime() - now.getTime()) / DAY_MS))
      : 0;

    // Atomic: update user location + (optionally) carry over days as new destination ticket + audit log
    const result = await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { locationId: toLocationId },
      });

      let destTicketId: number | null = null;
      let transferInPaymentId: number | null = null;
      if (carryOverDays && daysRemaining > 0) {
        // Cancel the source ticket so it doesn't grant access at the old location
        await tx.memberTicket.update({
          where: { id: ticketId },
          data: { status: "cancelled", cancelledAt: now },
        });

        const destExpire = new Date(now.getTime() + daysRemaining * DAY_MS);
        // R05: copy totalAmount / amountPaid / balanceDue onto the destination
        // ticket so balance-due tracking carries over, BUT do NOT let that
        // money show up as new revenue at the destination location. Revenue
        // was recognized when the source Payment was originally collected.
        // To make this explicit (and to keep an audit trail linking the two
        // tickets), we emit a zero-amount Payment row at the destination with
        // paymentMode='transfer_in'. Reporting (multi-location-rollup,
        // collections, GSTR-1, Tally) MUST exclude paymentMode IN
        // ('transfer_in','transfer_out') from collection sums to avoid
        // double-counting. We also write a 'transfer_out' audit-log entry at
        // the source side below for forensic traceability.
        const destTicket = await tx.memberTicket.create({
          data: {
            userId,
            planId: ticket.planId,
            locationId: toLocationId,
            buyDate: now,
            expireDate: destExpire,
            status: "active",
            isTrial: ticket.isTrial,
            totalAmount: ticket.totalAmount,
            amountPaid: ticket.amountPaid,
            balanceDue: ticket.balanceDue,
            dueDate: ticket.dueDate,
          },
        });
        destTicketId = destTicket.id;

        // Emit a tracking Payment row at the destination with amount=0 so
        // analytics can see the carry-over without inflating collections.
        // The reference back to the source ticket lives in paymentNote so it
        // survives without a schema change.
        const transferInPayment = await tx.payment.create({
          data: {
            userId,
            memberTicketId: destTicket.id,
            locationId: toLocationId,
            amount: 0,
            paymentMode: "transfer_in",
            paymentFor: "transfer_in",
            collectedById: transferredBy,
            paymentStatus: "full",
            paymentNote: `Transfer-in from ticket #${ticketId} (location #${fromLocationId ?? "n/a"} → #${toLocationId}). Carried ${daysRemaining} day(s). Original amountPaid=${Number(ticket.amountPaid)}, balanceDue=${Number(ticket.balanceDue)}.`,
          },
        });
        transferInPaymentId = transferInPayment.id;

        // Source-side audit row noting transfer_out so the two halves are
        // findable from either location's audit trail.
        await tx.auditLog.create({
          data: {
            action: "member_transfer.transfer_out",
            status: "success",
            details: JSON.stringify({
              userId,
              sourceTicketId: ticketId,
              sourceLocationId: fromLocationId,
              destTicketId,
              destLocationId: toLocationId,
              transferInPaymentId,
              daysCarried: daysRemaining,
              originalAmountPaid: Number(ticket.amountPaid),
              originalBalanceDue: Number(ticket.balanceDue),
              note: "No revenue movement — money was recognized at source on original Payment.",
            }),
            actorId: transferredBy,
            actorType: "worker",
          },
        });
      }

      await tx.auditLog.create({
        data: {
          action: "member_transfer",
          status: "success",
          details: JSON.stringify({
            userId,
            fromLocationId,
            toLocationId,
            ticketId,
            carryOverDays,
            daysRemaining,
            destTicketId,
            transferInPaymentId,
          }),
          actorId: transferredBy,
          actorType: "worker",
        },
      });

      return {
        userId,
        fromLocationId,
        toLocationId,
        toLocationName: toLocation.name,
        ticketId,
        carryOverDays,
        daysRemaining,
        destTicketId,
        transferInPaymentId,
      };
    });

    return { success: true as const, transferDetails: result };
  } catch (err) {
    console.error("[Member Transfer] Error:", err);
    return { success: false as const, error: "Failed to transfer member" };
  }
}
