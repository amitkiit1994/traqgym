"use server";

import { revalidatePath } from "next/cache";
import { requireWorker } from "@/lib/auth-guard";
import {
  issueKey,
  returnKey,
  markLost,
  reissueKey,
  getKeyIssuancesForLocker,
  getOutstandingKeys,
  getOverdueKeys,
} from "@/lib/services/locker-key";

function asWorkerId(session: { user: { id: string } }): number {
  return parseInt(session.user.id, 10);
}

export async function issueKeyAction(data: {
  lockerId: number;
  userId: number;
  depositAmount: number;
  expectedReturnAt?: string | null;
  conditionNotes?: string;
  witnessId?: number | null;
}) {
  let session;
  try {
    session = await requireWorker();
  } catch {
    return { success: false as const, error: "Unauthorized" };
  }
  const result = await issueKey({
    lockerId: data.lockerId,
    userId: data.userId,
    issuedById: asWorkerId(session),
    depositAmount: data.depositAmount,
    expectedReturnAt: data.expectedReturnAt ? new Date(data.expectedReturnAt) : null,
    conditionNotes: data.conditionNotes,
    witnessId: data.witnessId ?? null,
  });
  if (result.success) revalidatePath("/admin/lockers");
  return result;
}

export async function returnKeyAction(data: {
  issuanceId: number;
  conditionNotes?: string;
  refundDeposit?: boolean;
}) {
  let session;
  try {
    session = await requireWorker();
  } catch {
    return { success: false as const, error: "Unauthorized" };
  }
  const result = await returnKey({
    issuanceId: data.issuanceId,
    returnedById: asWorkerId(session),
    conditionNotes: data.conditionNotes,
    refundDeposit: data.refundDeposit,
  });
  if (result.success) revalidatePath("/admin/lockers");
  return result;
}

export async function markKeyLostAction(data: {
  issuanceId: number;
  penaltyAmount: number;
  witnessId?: number | null;
  photoUrl?: string | null;
}) {
  let session;
  try {
    session = await requireWorker(["admin"]);
  } catch {
    return { success: false as const, error: "Unauthorized" };
  }
  const result = await markLost({
    issuanceId: data.issuanceId,
    penaltyAmount: data.penaltyAmount,
    witnessId: data.witnessId ?? null,
    photoUrl: data.photoUrl ?? null,
    actorId: asWorkerId(session),
  });
  if (result.success) revalidatePath("/admin/lockers");
  return result;
}

export async function reissueKeyAction(data: {
  parentIssuanceId: number;
  newLockerId?: number;
  depositAmount: number;
  expectedReturnAt?: string | null;
}) {
  let session;
  try {
    session = await requireWorker(["admin"]);
  } catch {
    return { success: false as const, error: "Unauthorized" };
  }
  const result = await reissueKey({
    parentIssuanceId: data.parentIssuanceId,
    newLockerId: data.newLockerId,
    depositAmount: data.depositAmount,
    issuedById: asWorkerId(session),
    expectedReturnAt: data.expectedReturnAt ? new Date(data.expectedReturnAt) : null,
  });
  if (result.success) revalidatePath("/admin/lockers");
  return result;
}

type IssuanceRow = {
  id: number;
  lockerId: number;
  lockerNumber: string;
  userId: number;
  userName: string;
  userPhone: string | null;
  issuedAt: string;
  issuedByName: string;
  expectedReturnAt: string | null;
  returnedAt: string | null;
  returnedByName: string | null;
  depositAmount: number;
  depositRefundedAt: string | null;
  penaltyAmount: number;
  status: string;
  conditionNotes: string | null;
  witnessName: string | null;
  parentIssuanceId: number | null;
};

export async function getKeyIssuancesForLockerAction(
  lockerId: number
): Promise<IssuanceRow[]> {
  try {
    await requireWorker();
  } catch {
    return [];
  }
  const items = await getKeyIssuancesForLocker(lockerId);
  return items.map((i) => ({
    id: i.id,
    lockerId: i.lockerId,
    lockerNumber: "",
    userId: i.userId,
    userName: `${i.user.firstname} ${i.user.lastname}`.trim(),
    userPhone: i.user.phone ?? null,
    issuedAt: i.issuedAt.toISOString(),
    issuedByName: i.issuedBy
      ? `${i.issuedBy.firstname} ${i.issuedBy.lastname}`.trim()
      : "",
    expectedReturnAt: i.expectedReturnAt?.toISOString() ?? null,
    returnedAt: i.returnedAt?.toISOString() ?? null,
    returnedByName: i.returnedBy
      ? `${i.returnedBy.firstname} ${i.returnedBy.lastname}`.trim()
      : null,
    depositAmount: Number(i.depositAmount),
    depositRefundedAt: i.depositRefundedAt?.toISOString() ?? null,
    penaltyAmount: Number(i.penaltyAmount),
    status: i.status,
    conditionNotes: i.conditionNotes,
    witnessName: i.witness
      ? `${i.witness.firstname} ${i.witness.lastname}`.trim()
      : null,
    parentIssuanceId: i.parentIssuanceId,
  }));
}

export async function getOutstandingKeysAction(): Promise<IssuanceRow[]> {
  try {
    await requireWorker();
  } catch {
    return [];
  }
  const items = await getOutstandingKeys();
  return items.map((i) => ({
    id: i.id,
    lockerId: i.lockerId,
    lockerNumber: i.locker.number,
    userId: i.userId,
    userName: `${i.user.firstname} ${i.user.lastname}`.trim(),
    userPhone: i.user.phone ?? null,
    issuedAt: i.issuedAt.toISOString(),
    issuedByName: i.issuedBy
      ? `${i.issuedBy.firstname} ${i.issuedBy.lastname}`.trim()
      : "",
    expectedReturnAt: i.expectedReturnAt?.toISOString() ?? null,
    returnedAt: null,
    returnedByName: null,
    depositAmount: Number(i.depositAmount),
    depositRefundedAt: null,
    penaltyAmount: Number(i.penaltyAmount),
    status: i.status,
    conditionNotes: i.conditionNotes,
    witnessName: null,
    parentIssuanceId: i.parentIssuanceId,
  }));
}

export async function getOverdueKeysAction(thresholdDays = 7) {
  try {
    await requireWorker();
  } catch {
    return [];
  }
  const items = await getOverdueKeys(thresholdDays);
  return items.map((i) => ({
    id: i.id,
    lockerId: i.lockerId,
    lockerNumber: i.locker.number,
    userId: i.userId,
    userName: `${i.user.firstname} ${i.user.lastname}`.trim(),
    userPhone: i.user.phone ?? null,
    expectedReturnAt: i.expectedReturnAt?.toISOString() ?? null,
    depositAmount: Number(i.depositAmount),
  }));
}
