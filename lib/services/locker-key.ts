import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

type IssueKeyParams = {
  lockerId: number;
  userId: number;
  issuedById: number;
  depositAmount: number;
  expectedReturnAt?: Date | null;
  conditionNotes?: string;
  witnessId?: number | null;
  photoUrl?: string | null;
};

export async function issueKey(params: IssueKeyParams) {
  const locker = await prisma.locker.findUnique({ where: { id: params.lockerId } });
  if (!locker) return { success: false as const, error: "Locker not found" };

  const user = await prisma.user.findUnique({ where: { id: params.userId } });
  if (!user) return { success: false as const, error: "Member not found" };

  const worker = await prisma.worker.findUnique({ where: { id: params.issuedById } });
  if (!worker) return { success: false as const, error: "Issuing worker not found" };

  if (params.depositAmount < 0) {
    return { success: false as const, error: "Deposit amount must be non-negative" };
  }

  // Wrap the duplicate-check + create in a Serializable transaction so two
  // concurrent issuances cannot both pass the "no outstanding" check.
  try {
    const result = await prisma.$transaction(
      async (tx) => {
        const outstanding = await tx.lockerKeyIssuance.findFirst({
          where: { lockerId: params.lockerId, status: "issued" },
        });
        if (outstanding) {
          throw new Error("Locker key is already issued to another member");
        }

        const issuance = await tx.lockerKeyIssuance.create({
          data: {
            lockerId: params.lockerId,
            userId: params.userId,
            issuedById: params.issuedById,
            depositAmount: params.depositAmount,
            expectedReturnAt: params.expectedReturnAt ?? null,
            conditionNotes: params.conditionNotes ?? null,
            witnessId: params.witnessId ?? null,
            photoUrl: params.photoUrl ?? null,
            status: "issued",
          },
        });

        await tx.auditLog.create({
          data: {
            action: "locker_key_issued",
            status: "success",
            details: JSON.stringify({
              issuanceId: issuance.id,
              lockerId: params.lockerId,
              lockerNumber: locker.number,
              userId: params.userId,
              depositAmount: params.depositAmount,
              expectedReturnAt: params.expectedReturnAt?.toISOString() ?? null,
            }),
            actorId: params.issuedById,
            actorType: "worker",
          },
        });

        return issuance;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );

    return { success: true as const, issuance: result };
  } catch (err) {
    return {
      success: false as const,
      error:
        err instanceof Error
          ? err.message
          : "Failed to issue locker key",
    };
  }
}

type ReturnKeyParams = {
  issuanceId: number;
  returnedById: number;
  conditionNotes?: string;
  refundDeposit?: boolean;
};

export async function returnKey(params: ReturnKeyParams) {
  const worker = await prisma.worker.findUnique({ where: { id: params.returnedById } });
  if (!worker) return { success: false as const, error: "Returning worker not found" };

  const refundDeposit = params.refundDeposit !== false; // default true
  const now = new Date();

  // PR 12 audit fix (CRITICAL): idempotency + concurrency.
  //
  // The previous implementation read the issuance OUTSIDE the transaction
  // and then ran an unconditional `update({ where: { id } })`. Two near-
  // simultaneous returns would both see status="issued", both pass the
  // guard, both run the update — second write silently overwrote the first
  // (with a different worker, different timestamp). Move the status check
  // into a conditional `updateMany` inside the transaction so only one
  // writer wins; the loser sees count=0 and returns a clear error.
  try {
    const result = await prisma.$transaction(async (tx) => {
      const upd = await tx.lockerKeyIssuance.updateMany({
        where: { id: params.issuanceId, status: "issued" },
        data: {
          status: "returned",
          returnedAt: now,
          returnedById: params.returnedById,
          depositRefundedAt: refundDeposit ? now : null,
          ...(params.conditionNotes && params.conditionNotes.trim()
            ? { conditionNotes: params.conditionNotes.trim() }
            : {}),
        },
      });
      if (upd.count === 0) {
        // Either the row doesn't exist or it isn't in `issued` state any more.
        const current = await tx.lockerKeyIssuance.findUnique({
          where: { id: params.issuanceId },
          select: { id: true, status: true },
        });
        if (!current) throw new Error("Key issuance not found");
        throw new Error(
          `Cannot return a key with status: ${current.status}`,
        );
      }

      const issuance = await tx.lockerKeyIssuance.findUniqueOrThrow({
        where: { id: params.issuanceId },
      });

      await tx.auditLog.create({
        data: {
          action: "locker_key_returned",
          status: "success",
          details: JSON.stringify({
            issuanceId: issuance.id,
            lockerId: issuance.lockerId,
            userId: issuance.userId,
            depositRefunded: refundDeposit,
            depositAmount: Number(issuance.depositAmount),
          }),
          actorId: params.returnedById,
          actorType: "worker",
        },
      });

      return issuance;
    });

    return { success: true as const, issuance: result };
  } catch (err) {
    return {
      success: false as const,
      error:
        err instanceof Error ? err.message : "Failed to return locker key",
    };
  }
}

type MarkLostParams = {
  issuanceId: number;
  witnessId?: number | null;
  penaltyAmount: number;
  photoUrl?: string | null;
  actorId: number;
};

export async function markLost(params: MarkLostParams) {
  if (params.penaltyAmount < 0) {
    return { success: false as const, error: "Penalty amount must be non-negative" };
  }

  // PR 12 audit fix (CRITICAL): idempotency + concurrency.
  //
  // Same flaw as returnKey — read-then-write across the transaction
  // boundary let two concurrent "mark lost" calls both succeed (one
  // overwriting the other's penaltyAmount + witness). Atomic conditional
  // updateMany inside the tx fixes it: first call wins, second gets a
  // clear "already in status X" error.
  //
  // Note: the schema's Payment model requires `memberTicketId`, so the
  // forfeited deposit and the new penalty cannot be expressed as
  // standalone Payment rows without a ticket fabrication. Audit log
  // captures the financial intent here; surfacing the deposit forfeit +
  // penalty into the cash drawer is a follow-up that needs schema work
  // (e.g. `MemberTicket?` on Payment) — tracked separately.
  try {
    const result = await prisma.$transaction(async (tx) => {
      const upd = await tx.lockerKeyIssuance.updateMany({
        where: { id: params.issuanceId, status: "issued" },
        data: {
          status: "lost",
          penaltyAmount: params.penaltyAmount,
          ...(params.witnessId != null ? { witnessId: params.witnessId } : {}),
          ...(params.photoUrl != null ? { photoUrl: params.photoUrl } : {}),
        },
      });
      if (upd.count === 0) {
        const current = await tx.lockerKeyIssuance.findUnique({
          where: { id: params.issuanceId },
          select: { id: true, status: true },
        });
        if (!current) throw new Error("Key issuance not found");
        throw new Error(
          `Cannot mark lost a key with status: ${current.status}`,
        );
      }

      const issuance = await tx.lockerKeyIssuance.findUniqueOrThrow({
        where: { id: params.issuanceId },
      });

      await tx.auditLog.create({
        data: {
          action: "locker_key_lost",
          status: "success",
          details: JSON.stringify({
            issuanceId: issuance.id,
            lockerId: issuance.lockerId,
            userId: issuance.userId,
            penaltyAmount: params.penaltyAmount,
            depositForfeit: Number(issuance.depositAmount),
            witnessId: params.witnessId ?? issuance.witnessId,
          }),
          actorId: params.actorId,
          actorType: "worker",
        },
      });

      return issuance;
    });

    return { success: true as const, issuance: result };
  } catch (err) {
    return {
      success: false as const,
      error:
        err instanceof Error ? err.message : "Failed to mark key lost",
    };
  }
}

type ReissueKeyParams = {
  parentIssuanceId: number;
  newLockerId?: number;
  depositAmount: number;
  issuedById: number;
  expectedReturnAt?: Date | null;
};

export async function reissueKey(params: ReissueKeyParams) {
  const parent = await prisma.lockerKeyIssuance.findUnique({
    where: { id: params.parentIssuanceId },
  });
  if (!parent) return { success: false as const, error: "Parent issuance not found" };
  if (parent.status === "issued") {
    return {
      success: false as const,
      error: "Cannot reissue while parent key is still active. Mark lost or return first.",
    };
  }

  const lockerId = params.newLockerId ?? parent.lockerId;
  const locker = await prisma.locker.findUnique({ where: { id: lockerId } });
  if (!locker) return { success: false as const, error: "Locker not found" };

  if (params.depositAmount < 0) {
    return { success: false as const, error: "Deposit amount must be non-negative" };
  }

  // Wrap the duplicate-check + create in a Serializable transaction so two
  // concurrent reissuances cannot both pass the "no outstanding" check.
  try {
    const created = await prisma.$transaction(
      async (tx) => {
        const outstanding = await tx.lockerKeyIssuance.findFirst({
          where: { lockerId, status: "issued" },
        });
        if (outstanding) {
          throw new Error("Locker key is already issued to another member");
        }

        const issuance = await tx.lockerKeyIssuance.create({
          data: {
            lockerId,
            userId: parent.userId,
            issuedById: params.issuedById,
            depositAmount: params.depositAmount,
            expectedReturnAt: params.expectedReturnAt ?? null,
            parentIssuanceId: parent.id,
            status: "issued",
          },
        });

        await tx.auditLog.create({
          data: {
            action: "locker_key_reissued",
            status: "success",
            details: JSON.stringify({
              issuanceId: issuance.id,
              parentIssuanceId: parent.id,
              lockerId,
              userId: parent.userId,
              depositAmount: params.depositAmount,
            }),
            actorId: params.issuedById,
            actorType: "worker",
          },
        });

        return issuance;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );

    return { success: true as const, issuance: created };
  } catch (err) {
    return {
      success: false as const,
      error:
        err instanceof Error ? err.message : "Failed to reissue locker key",
    };
  }
}

export async function getOverdueKeys(thresholdDays = 7) {
  const cutoff = new Date(Date.now() - thresholdDays * 24 * 60 * 60 * 1000);
  return prisma.lockerKeyIssuance.findMany({
    where: {
      status: "issued",
      expectedReturnAt: { not: null, lt: cutoff },
    },
    include: {
      locker: { select: { number: true, locationId: true } },
      user: { select: { firstname: true, lastname: true, phone: true } },
    },
    orderBy: { expectedReturnAt: "asc" },
  });
}

export async function getKeyIssuancesForLocker(lockerId: number) {
  return prisma.lockerKeyIssuance.findMany({
    where: { lockerId },
    include: {
      user: { select: { id: true, firstname: true, lastname: true, phone: true } },
      issuedBy: { select: { id: true, firstname: true, lastname: true } },
      returnedBy: { select: { id: true, firstname: true, lastname: true } },
      witness: { select: { id: true, firstname: true, lastname: true } },
    },
    orderBy: { issuedAt: "desc" },
  });
}

export async function getOutstandingKeys() {
  return prisma.lockerKeyIssuance.findMany({
    where: { status: "issued" },
    include: {
      locker: { select: { id: true, number: true } },
      user: { select: { id: true, firstname: true, lastname: true, phone: true } },
      issuedBy: { select: { id: true, firstname: true, lastname: true } },
    },
    orderBy: { issuedAt: "desc" },
  });
}
