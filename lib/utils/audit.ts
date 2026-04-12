/* eslint-disable @typescript-eslint/no-explicit-any */

export async function createAuditLog(
  tx: any,
  action: string,
  details: string,
  actorId?: number
) {
  return tx.auditLog.create({
    data: {
      action,
      status: "success",
      details,
      actorId: actorId ?? null,
      actorType: "worker",
    },
  });
}
