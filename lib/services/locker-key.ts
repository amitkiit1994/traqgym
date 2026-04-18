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

  // Check there isn't already an outstanding issuance for this locker
  const outstanding = await prisma.lockerKeyIssuance.findFirst({
    where: { lockerId: params.lockerId, status: "issued" },
  });
  if (outstanding) {
    return {
      success: false as const,
      error: "Locker key is already issued to another member",
    };
  }

  const result = await prisma.$transaction(async (tx) => {
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
  });

  return { success: true as const, issuance: result };
}

type ReturnKeyParams = {
  issuanceId: number;
  returnedById: number;
  conditionNotes?: string;
  refundDeposit?: boolean;
};

export async function returnKey(params: ReturnKeyParams) {
  const issuance = await prisma.lockerKeyIssuance.findUnique({
    where: { id: params.issuanceId },
  });
  if (!issuance) return { success: false as const, error: "Key issuance not found" };
  if (issuance.status !== "issued") {
    return { success: false as const, error: `Cannot return a key with status: ${issuance.status}` };
  }

  const worker = await prisma.worker.findUnique({ where: { id: params.returnedById } });
  if (!worker) return { success: false as const, error: "Returning worker not found" };

  const refundDeposit = params.refundDeposit !== false; // default true
  const now = new Date();

  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.lockerKeyIssuance.update({
      where: { id: params.issuanceId },
      data: {
        status: "returned",
        returnedAt: now,
        returnedById: params.returnedById,
        depositRefundedAt: refundDeposit ? now : null,
        conditionNotes:
          params.conditionNotes && params.conditionNotes.trim()
            ? params.conditionNotes.trim()
            : issuance.conditionNotes,
      },
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

    return result;
  });

  return { success: true as const, issuance: updated };
}

type MarkLostParams = {
  issuanceId: number;
  witnessId?: number | null;
  penaltyAmount: number;
  photoUrl?: string | null;
  actorId: number;
};

export async function markLost(params: MarkLostParams) {
  const issuance = await prisma.lockerKeyIssuance.findUnique({
    where: { id: params.issuanceId },
  });
  if (!issuance) return { success: false as const, error: "Key issuance not found" };
  if (issuance.status !== "issued") {
    return { success: false as const, error: `Cannot mark lost a key with status: ${issuance.status}` };
  }
  if (params.penaltyAmount < 0) {
    return { success: false as const, error: "Penalty amount must be non-negative" };
  }

  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.lockerKeyIssuance.update({
      where: { id: params.issuanceId },
      data: {
        status: "lost",
        penaltyAmount: params.penaltyAmount,
        witnessId: params.witnessId ?? issuance.witnessId,
        photoUrl: params.photoUrl ?? issuance.photoUrl,
      },
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

    return result;
  });

  return { success: true as const, issuance: updated };
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

  // Make sure the new locker isn't already issued
  const outstanding = await prisma.lockerKeyIssuance.findFirst({
    where: { lockerId, status: "issued" },
  });
  if (outstanding) {
    return {
      success: false as const,
      error: "Locker key is already issued to another member",
    };
  }

  const created = await prisma.$transaction(async (tx) => {
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
  });

  return { success: true as const, issuance: created };
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
