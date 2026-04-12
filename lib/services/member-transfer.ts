import { prisma } from "@/lib/prisma";

export async function transferMember({
  userId,
  toLocationId,
  ticketId,
  transferredBy,
}: {
  userId: number;
  toLocationId: number;
  ticketId: number;
  transferredBy: number;
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

    // Atomic: update user location + create audit log
    const result = await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { locationId: toLocationId },
      });

      await tx.auditLog.create({
        data: {
          action: "member_transfer",
          status: "success",
          details: JSON.stringify({
            userId,
            fromLocationId,
            toLocationId,
            ticketId,
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
      };
    });

    return { success: true as const, transferDetails: result };
  } catch (err) {
    console.error("[Member Transfer] Error:", err);
    return { success: false as const, error: "Failed to transfer member" };
  }
}
